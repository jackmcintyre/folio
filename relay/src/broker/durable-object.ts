/**
 * RelayBroker — the Cloudflare Durable Object that realises the single-Puller
 * broker (AR-7, AD-13, AD-14/AD-18). Named in `relay/wrangler.toml`'s
 * `[durable_objects]` binding (`RELAY_BROKER` → class `RelayBroker`).
 *
 * This is a THIN Hibernation adapter: it owns the real (hibernatable) WebSocket
 * to the Puller and delegates EVERY decision to `BrokerCore` (./core.ts), which
 * is where the acceptance criteria are proven under Node. The split exists
 * because the core must be unit-testable without the Workers runtime, while the
 * socket lifecycle below can only run inside a Durable Object.
 *
 * WebSocket Hibernation (AC1): the Puller link is accepted with
 * `ctx.acceptWebSocket`, so the runtime keeps it OPEN across an idle eviction
 * without holding this object in memory ("the connection survives an idle period
 * without being dropped"). On the next event the object is reconstructed and the
 * surviving socket is re-adopted into a fresh core (see `core()`), each socket
 * carrying its connection epoch in its serialized attachment so inbound acks can
 * be epoch-checked (AC3). Hibernation is an implementation detail of AC1 — the
 * observable contract is "exactly one live connection that survives idle".
 *
 * Note on epoch across an eviction: the primary guard against misrouting a stale
 * ack is the ULID correlation id (never reused — AC2), which makes an unmatched
 * ack droppable regardless of epoch (AC3). The epoch is the secondary,
 * within-session guard; re-stamping the surviving socket on re-adoption keeps it
 * consistent without needing durable epoch storage.
 */

import { DurableObject } from "cloudflare:workers";
import type { BrokerConnection } from "./core.js";
import { BrokerCore } from "./core.js";
import { relayEncode, relayDecode } from "./frame-codec.js";

/** Bindings this DO needs from the Worker environment (none yet). */
export interface BrokerEnv {
  readonly RELAY_BROKER: DurableObjectNamespace;
}

/** The epoch we stamp onto each accepted WebSocket's serialized attachment. */
interface SocketAttachment {
  readonly epoch: number;
}

export class RelayBroker extends DurableObject<BrokerEnv> {
  /** Lazily built; rebuilt (and re-adopts surviving sockets) after a wake. */
  private broker?: BrokerCore;

  /**
   * The broker core for this object, reconstructed after a hibernation wake.
   * On first access it adopts every surviving (hibernated) WebSocket — there is
   * at most one in steady state; if more are present, `attach` displaces the
   * earlier ones so the registry still holds exactly one connection (AC1/AC5).
   */
  private core(): BrokerCore {
    if (this.broker !== undefined) {
      return this.broker;
    }
    const core = new BrokerCore();
    for (const ws of this.ctx.getWebSockets()) {
      this.adopt(core, ws);
    }
    this.broker = core;
    return core;
  }

  /** Register one WebSocket as the live Puller link and stamp its epoch. */
  private adopt(core: BrokerCore, ws: WebSocket): void {
    const epoch = core.attach(connectionFor(ws));
    const attachment: SocketAttachment = { epoch };
    ws.serializeAttachment(attachment);
  }

  /**
   * HTTP entry. A WebSocket upgrade is the Puller hop attaching; any other
   * request is an internal Filing dispatch from the Worker handler carrying the
   * request body and idempotency key.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      return this.acceptPuller();
    }
    return this.dispatchFiling(request);
  }

  /** Accept the Puller's WebSocket with Hibernation and adopt it into the core. */
  private acceptPuller(): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.adopt(this.core(), server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Forward an internal Filing dispatch to the core and return its outcome. */
  private async dispatchFiling(request: Request): Promise<Response> {
    const idempotencyKey = request.headers.get("X-Folio-Idempotency-Key") ?? "";
    const body = new Uint8Array(await request.arrayBuffer());
    const result = await this.core().dispatch(body, idempotencyKey);
    return Response.json(result);
  }

  /** Inbound frame from the Puller: route a response to its pending caller. */
  override webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    const bytes =
      typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
    let frame;
    try {
      frame = relayDecode(bytes);
    } catch {
      return; // malformed frame: drop, never crash the broker
    }
    if (frame.type === "response") {
      this.core().onResponse(frame, epochOf(ws));
    }
  }

  /** The Puller link dropped: fail every in-flight caller on this epoch (AC4). */
  override webSocketClose(ws: WebSocket): void {
    this.core().detach(epochOf(ws));
  }
}

/** Build a BrokerConnection over a live Workers WebSocket. */
function connectionFor(ws: WebSocket): BrokerConnection {
  return {
    send: (frame) => ws.send(relayEncode(frame)),
    close: () => ws.close(),
  };
}

/** Read the connection epoch stamped onto a WebSocket's attachment. */
function epochOf(ws: WebSocket): number {
  const attachment = ws.deserializeAttachment() as SocketAttachment | null;
  return attachment?.epoch ?? -1;
}
