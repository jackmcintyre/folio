/**
 * broker core — the single-Puller connection broker, transport-agnostic
 * (AR-7, AD-13, AD-14/AD-18).
 *
 * This class is the ENTIRE decision logic of the Durable Object broker, written
 * with no Cloudflare-runtime dependency so it can be unit-tested under Node
 * against the same acceptance criteria the DO realises. The DO wrapper
 * (./durable-object.ts) is a thin Hibernation adapter that owns the real
 * WebSockets and delegates every decision here; this file owns:
 *
 *   - the connection registry: exactly ONE live Puller connection (AC1);
 *   - per-request correlation ids that are NEVER reused (DO-lifetime monotonic
 *     ULID — the vetted `ulid` library, not a per-connection counter — AC2);
 *   - the connection epoch, bumped on every attach so a stale link's acks are
 *     droppable (AC2/AC3/AC5);
 *   - ack routing: map a correlation id to its pending caller, dropping any ack
 *     that is unmatched OR stale-epoch and never applying it to another caller
 *     (AC3);
 *   - failure fan-out: on a drop OR a displacement, fail every in-flight caller
 *     with `puller_offline` (safe to retry under Epic 3) (AC4/AC5).
 *
 * The correlation id is generated with `ulid`'s monotonic factory (AD-18 /
 * primitive-allowlist): lexicographically sortable, collision-resistant, and —
 * via the monotonic factory held for this broker's lifetime — strictly
 * increasing, so an id is never reused even within a single millisecond.
 */

import { monotonicFactory } from "ulid";
import type {
  FrameRequest,
  FrameResponse,
  Receipt,
  TypedError,
} from "../../../shared/frame-protocol/index.js";
import { FRAME_PROTOCOL_VERSION } from "../../../shared/frame-protocol/index.js";

/** A Filing outcome carried back to the caller: a Receipt or a typed error. */
export type BrokerResult = Receipt | TypedError;

/**
 * The minimal contract the broker needs from a live Puller link. The DO wrapper
 * implements this over a real (hibernatable) WebSocket; tests implement it with
 * an in-memory double. `send` hands an encoded request frame to the Puller;
 * `close` (optional) lets the broker tear down a link it has displaced.
 */
export interface BrokerConnection {
  /** Forward one request frame to the Puller over this link. */
  send(frame: FrameRequest): void;
  /** Close this link (used when displacing an incumbent); optional for tests. */
  close?(): void;
}

/** What happened to an inbound response frame (AC3) — for tracing and tests. */
export type AckOutcome = "applied" | "dropped-unmatched" | "dropped-stale";

/** A caller awaiting the Puller's ack for one forwarded Filing. */
interface PendingCaller {
  readonly epoch: number;
  resolve(result: BrokerResult): void;
}

/** The `puller_offline` typed error returned to a failed in-flight caller. */
function pullerOffline(message: string): TypedError {
  return { error: "puller_offline", message };
}

/**
 * The single-connection broker. One instance brokers one Puller link at a time;
 * a second attach DISPLACES the incumbent rather than being rejected (AC5),
 * because the common trigger is the home Puller reconnecting after a drop.
 */
export class BrokerCore {
  private connection: BrokerConnection | undefined;
  /** Current connection epoch. 0 = no connection has ever attached. */
  private epoch = 0;
  /** correlationId → caller awaiting its ack. */
  private readonly pending = new Map<string, PendingCaller>();
  /** DO-lifetime monotonic ULID factory — correlation ids never repeat (AC2). */
  private readonly nextId: () => string;

  /** @param idFactory injectable id source (tests); defaults to ulid monotonic. */
  constructor(idFactory: () => string = monotonicFactory()) {
    this.nextId = idFactory;
  }

  /** True iff a live Puller connection is registered. */
  get hasConnection(): boolean {
    return this.connection !== undefined;
  }

  /** Registered-connection count — exactly 0 or 1 (AC1). */
  get connectionCount(): number {
    return this.connection === undefined ? 0 : 1;
  }

  /** The current connection epoch (0 before the first attach). */
  get currentEpoch(): number {
    return this.epoch;
  }

  /** Number of in-flight callers awaiting an ack. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Register a Puller connection and return its epoch. If a connection is
   * already registered it is DISPLACED (AC5): the epoch is bumped (rendering the
   * old link's acks stale per AC3), every in-flight caller on the displaced link
   * is failed with `puller_offline`, and the old link is closed. The registry
   * then holds exactly one connection — the new one.
   */
  attach(connection: BrokerConnection): number {
    const displaced = this.connection;
    this.epoch += 1;
    this.connection = connection;
    if (displaced !== undefined) {
      this.failAllPending("Puller connection displaced by a newer attach.");
      displaced.close?.();
    }
    return this.epoch;
  }

  /**
   * Forward one Filing to the Puller and resolve when its ack returns. Assigns a
   * never-reused correlation id tagged with the current epoch (AC2). With no
   * live connection the Filing hard-fails `puller_offline` immediately (AD-11).
   */
  dispatch(body: Uint8Array, idempotencyKey: string): Promise<BrokerResult> {
    const connection = this.connection;
    if (connection === undefined) {
      return Promise.resolve(pullerOffline("No Puller connection is registered."));
    }
    const correlationId = this.nextId();
    const epoch = this.epoch;
    const frame: FrameRequest = {
      v: FRAME_PROTOCOL_VERSION,
      type: "request",
      correlationId,
      idempotencyKey,
      body,
      size: body.byteLength,
    };
    return new Promise<BrokerResult>((resolve) => {
      this.pending.set(correlationId, { epoch, resolve });
      connection.send(frame);
    });
  }

  /**
   * Apply an inbound response frame from the Puller. `linkEpoch` is the epoch of
   * the link the frame arrived on. The frame is DROPPED — never applied to any
   * caller — when it is stale (its link is not the current epoch) OR unmatched
   * (no pending caller for its correlation id: already resolved, already failed,
   * or never issued) (AC3). Otherwise it resolves exactly its one caller.
   */
  onResponse(frame: FrameResponse, linkEpoch: number): AckOutcome {
    if (linkEpoch !== this.epoch) {
      return "dropped-stale";
    }
    const caller = this.pending.get(frame.correlationId);
    if (caller === undefined) {
      return "dropped-unmatched";
    }
    this.pending.delete(frame.correlationId);
    caller.resolve(frame.result);
    return "applied";
  }

  /**
   * Handle a WebSocket drop on the link with epoch `linkEpoch`. If it is the
   * current link, every in-flight caller is failed with `puller_offline` (safe
   * to retry under Epic 3) and the registry is emptied (AC4). A drop on an
   * already-displaced link is ignored — its callers were failed at displacement.
   * Returns true iff this drop cleared the current connection.
   */
  detach(linkEpoch: number): boolean {
    if (linkEpoch !== this.epoch) {
      return false;
    }
    this.connection = undefined;
    this.failAllPending("Puller connection dropped before the Filing completed.");
    return true;
  }

  /** Fail and clear every in-flight caller with a `puller_offline` error. */
  private failAllPending(message: string): void {
    const error = pullerOffline(message);
    for (const caller of this.pending.values()) {
      caller.resolve(error);
    }
    this.pending.clear();
  }
}
