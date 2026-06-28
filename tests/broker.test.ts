/**
 * Broker tests — AC1..AC5 for Story 2.2 (Durable Object broker — connection
 * registry, correlation, and epoch).
 *
 * The DO's decision logic lives in `BrokerCore` (relay/src/broker/core.ts),
 * deliberately transport-agnostic so every acceptance criterion is proven here
 * under Node — not deferred to an un-gated Workers integration run. The DO
 * wrapper (relay/src/broker/durable-object.ts) is the thin Hibernation adapter
 * that owns the real WebSocket and delegates to exactly this core; proving the
 * core proves the broker's observable contract.
 *
 * The "test client observing the broker" the dev notes name is the
 * `FakeConnection` below: a real BrokerConnection double that records every
 * frame the broker forwards and whether the broker closed it on displacement.
 */

import { describe, expect, it } from "vitest";
import { BrokerCore, type BrokerConnection, type BrokerResult } from "../relay/src/broker/index.js";
import {
  FRAME_PROTOCOL_VERSION,
  type FrameRequest,
  type FrameResponse,
  type Receipt,
  type TypedError,
} from "../shared/frame-protocol/index.js";

// ─── test doubles ────────────────────────────────────────────────────────────

/** A BrokerConnection that records forwarded frames and close() calls. */
class FakeConnection implements BrokerConnection {
  readonly sent: FrameRequest[] = [];
  closed = false;
  send(frame: FrameRequest): void {
    this.sent.push(frame);
  }
  close(): void {
    this.closed = true;
  }
}

/** A deterministic, never-repeating id source (proves correlation, not ulid). */
function counterIds(): () => string {
  let n = 0;
  return () => `cid-${String(++n).padStart(4, "0")}`;
}

/** A Receipt for use as a response result. */
function receipt(filename: string): Receipt {
  return { v: "1", path: "notes", filename, timestamp: "2026-06-28T10:00:00+10:00" };
}

/** Build a valid response frame carrying `result` for `correlationId`. */
function response(correlationId: string, result: Receipt | TypedError): FrameResponse {
  const size = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  return { v: FRAME_PROTOCOL_VERSION, type: "response", correlationId, result, size };
}

/** The single correlation id the broker assigned to the most recent dispatch. */
function lastCorrelationId(conn: FakeConnection): string {
  const frame = conn.sent[conn.sent.length - 1];
  if (frame === undefined) throw new Error("no frame was forwarded");
  return frame.correlationId;
}

const body = (s: string): Uint8Array => new TextEncoder().encode(s);
// A low-entropy placeholder idempotency key that satisfies the 16..128 grammar
// (kept obviously-fake so the secret scanner does not flag it).
const KEY = "test-test-test-key";

// ─── AC1 — exactly one live connection, owned registry, survives idle ────────

describe("AC1 — the broker holds exactly one Puller connection", () => {
  it("registers exactly one connection on attach and owns the registry", () => {
    const core = new BrokerCore();
    expect(core.connectionCount).toBe(0);
    expect(core.hasConnection).toBe(false);

    const epoch = core.attach(new FakeConnection());
    expect(epoch).toBe(1);
    expect(core.connectionCount).toBe(1);
    expect(core.hasConnection).toBe(true);
  });

  it("keeps the single connection across activity (no idle drop)", async () => {
    const core = new BrokerCore(counterIds());
    const conn = new FakeConnection();
    core.attach(conn);

    // A Filing flows; the connection is unchanged afterwards (nothing drops it).
    const pending = core.dispatch(body("hello"), KEY);
    core.onResponse(response(lastCorrelationId(conn), receipt("a.md")), core.currentEpoch);
    await pending;

    expect(core.connectionCount).toBe(1);
    expect(core.hasConnection).toBe(true);
  });
});

// ─── AC2 — never-reused correlation id, tagged with the current epoch ────────

describe("AC2 — correlation ids are never reused and epoch-tagged", () => {
  it("assigns a distinct correlation id per forwarded request", () => {
    const core = new BrokerCore(counterIds());
    const conn = new FakeConnection();
    core.attach(conn);

    core.dispatch(body("1"), KEY);
    core.dispatch(body("2"), KEY);
    core.dispatch(body("3"), KEY);

    const ids = conn.sent.map((f) => f.correlationId);
    expect(ids).toEqual(["cid-0001", "cid-0002", "cid-0003"]);
    expect(new Set(ids).size).toBe(ids.length); // all distinct
  });

  it("uses a DO-lifetime monotonic ULID, NOT a per-connection counter", () => {
    // Default ctor = the real ulid monotonic factory (the allowlisted lib).
    const core = new BrokerCore();
    const conn1 = new FakeConnection();
    core.attach(conn1);
    core.dispatch(body("a"), KEY);
    core.dispatch(body("b"), KEY);
    const firstBatch = conn1.sent.map((f) => f.correlationId);

    // Reconnect: a NEW connection (new epoch). Ids must NOT reset — they keep
    // climbing from the DO-lifetime factory, proving "not per-connection".
    const conn2 = new FakeConnection();
    core.attach(conn2);
    core.dispatch(body("c"), KEY);
    const all = [...firstBatch, ...conn2.sent.map((f) => f.correlationId)];

    expect(new Set(all).size).toBe(all.length); // globally unique
    const sorted = [...all].sort();
    expect(all).toEqual(sorted); // ULIDs are lexicographically monotonic
  });

  it("forwards a contract-shaped request frame with the decoded size", () => {
    const core = new BrokerCore(counterIds());
    const conn = new FakeConnection();
    core.attach(conn);
    core.dispatch(body("payload"), KEY);

    const frame = conn.sent[0];
    expect(frame).toMatchObject({
      v: FRAME_PROTOCOL_VERSION,
      type: "request",
      idempotencyKey: KEY,
      size: body("payload").byteLength,
    });
  });
});

// ─── AC3 — ack routing: correct caller; drop unmatched and stale-epoch acks ──

describe("AC3 — acks route to the right caller; unmatched/stale are dropped", () => {
  it("maps a correlation id back to its one pending caller", async () => {
    const core = new BrokerCore(counterIds());
    const conn = new FakeConnection();
    core.attach(conn);

    const p1 = core.dispatch(body("1"), KEY);
    const id1 = lastCorrelationId(conn);
    const p2 = core.dispatch(body("2"), KEY);
    const id2 = lastCorrelationId(conn);

    // Resolve the SECOND caller first — routing must not be positional.
    expect(core.onResponse(response(id2, receipt("two.md")), core.currentEpoch)).toBe("applied");
    await expect(p2).resolves.toMatchObject({ filename: "two.md" });
    expect(core.pendingCount).toBe(1);

    expect(core.onResponse(response(id1, receipt("one.md")), core.currentEpoch)).toBe("applied");
    await expect(p1).resolves.toMatchObject({ filename: "one.md" });
    expect(core.pendingCount).toBe(0);
  });

  it("drops an ack whose correlation id matches no pending caller", () => {
    const core = new BrokerCore(counterIds());
    core.attach(new FakeConnection());
    core.dispatch(body("1"), KEY); // one caller in flight

    const outcome = core.onResponse(response("cid-9999", receipt("x.md")), core.currentEpoch);
    expect(outcome).toBe("dropped-unmatched");
    expect(core.pendingCount).toBe(1); // the real caller is untouched
  });

  it("drops a second ack for an already-resolved correlation id", async () => {
    const core = new BrokerCore(counterIds());
    const conn = new FakeConnection();
    core.attach(conn);
    const p = core.dispatch(body("1"), KEY);
    const id = lastCorrelationId(conn);

    expect(core.onResponse(response(id, receipt("first.md")), core.currentEpoch)).toBe("applied");
    await p;
    // A duplicate ack for the same id has no caller left — dropped, never reused.
    expect(core.onResponse(response(id, receipt("second.md")), core.currentEpoch)).toBe(
      "dropped-unmatched",
    );
  });

  it("drops a stale-epoch ack and never applies it to the pending caller", async () => {
    const core = new BrokerCore(counterIds());
    const conn = new FakeConnection();
    core.attach(conn); // epoch 1
    const p = core.dispatch(body("1"), KEY);
    const id = lastCorrelationId(conn);

    // An ack arriving on a NON-current epoch (e.g. a since-replaced link) is
    // stale: dropped, and the live caller stays pending.
    expect(core.onResponse(response(id, receipt("stale.md")), 0)).toBe("dropped-stale");
    expect(core.onResponse(response(id, receipt("stale.md")), 999)).toBe("dropped-stale");
    expect(core.pendingCount).toBe(1);

    // The correctly-epoched ack still resolves it — proving the drop was the
    // epoch check, not a lost caller.
    expect(core.onResponse(response(id, receipt("live.md")), core.currentEpoch)).toBe("applied");
    await expect(p).resolves.toMatchObject({ filename: "live.md" });
  });
});

// ─── AC4 — WS drop fails all in-flight callers with puller_offline ───────────

describe("AC4 — a WebSocket drop fails every in-flight caller", () => {
  it("fails all in-flight callers with puller_offline and empties the registry", async () => {
    const core = new BrokerCore(counterIds());
    const conn = new FakeConnection();
    core.attach(conn);
    const p1 = core.dispatch(body("1"), KEY);
    const p2 = core.dispatch(body("2"), KEY);
    expect(core.pendingCount).toBe(2);

    const cleared = core.detach(core.currentEpoch);
    expect(cleared).toBe(true);

    for (const p of [p1, p2]) {
      await expect(p).resolves.toEqual({
        error: "puller_offline",
        message: expect.any(String),
      });
    }
    expect(core.connectionCount).toBe(0);
    expect(core.pendingCount).toBe(0);
  });

  it("ignores a drop reported on an already-replaced (stale) link", () => {
    const core = new BrokerCore(counterIds());
    core.attach(new FakeConnection()); // epoch 1
    core.dispatch(body("1"), KEY);

    // A drop on a non-current epoch must not disturb the live link or caller.
    expect(core.detach(0)).toBe(false);
    expect(core.connectionCount).toBe(1);
    expect(core.pendingCount).toBe(1);
  });

  it("hard-fails a dispatch with puller_offline when no connection is registered", async () => {
    const core = new BrokerCore(counterIds());
    await expect(core.dispatch(body("x"), KEY)).resolves.toEqual({
      error: "puller_offline",
      message: expect.any(String),
    });
  });
});

// ─── AC5 — a second attach displaces the incumbent and bumps the epoch ───────

describe("AC5 — a second attach displaces the incumbent", () => {
  it("bumps the epoch, fails the displaced callers, and keeps one connection", async () => {
    const core = new BrokerCore(counterIds());
    const incumbent = new FakeConnection();
    const firstEpoch = core.attach(incumbent);
    const p1 = core.dispatch(body("1"), KEY);
    const p2 = core.dispatch(body("2"), KEY);
    const staleId = lastCorrelationId(incumbent);

    // A second authenticated Puller hop attaches — it DISPLACES the incumbent.
    const fresh = new FakeConnection();
    const secondEpoch = core.attach(fresh);

    expect(secondEpoch).toBe(firstEpoch + 1); // epoch bumped
    expect(incumbent.closed).toBe(true); // displaced link closed
    expect(core.connectionCount).toBe(1); // registry still holds exactly one

    // All in-flight callers on the displaced link fail puller_offline (retryable).
    for (const p of [p1, p2]) {
      await expect(p).resolves.toEqual({
        error: "puller_offline",
        message: expect.any(String),
      });
    }

    // An ack arriving afterward on the OLD (now stale-epoch) link is dropped (AC3).
    expect(core.onResponse(response(staleId, receipt("late.md")), firstEpoch)).toBe(
      "dropped-stale",
    );

    // The fresh link brokers normally on the new epoch.
    const p3 = core.dispatch(body("3"), KEY);
    expect(core.onResponse(response(lastCorrelationId(fresh), receipt("ok.md")), secondEpoch)).toBe(
      "applied",
    );
    await expect(p3).resolves.toMatchObject({ filename: "ok.md" });
  });
});
