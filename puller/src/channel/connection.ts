/**
 * connection — the outbound channel's WS lifecycle (Story 2.1 / AD-15 / AD-16).
 *
 * The puller is the WebSocket CLIENT on the Relay↔Puller hop. It dials out to
 * the relay, authenticates the hop with its static bearer on the upgrade, holds
 * the line open with a heartbeat, and reconnects with bounded exponential
 * backoff on any drop (AC1-AC3). It opens NO inbound listener — the home server
 * stays pull-only (AC1 / NFR-2): this class constructs `WebSocket` only as a
 * client and never an inbound WS server.
 *
 * The bearer travels in the `Authorization: Bearer <token>` header of every
 * upgrade, so the relay refuses the connection BEFORE the channel is established
 * when it is missing/invalid (AC4) — and so every reconnect re-authenticates
 * (AC3). The bearer is sourced from the secret store by the caller (see
 * loadChannelEnv in ./index.ts); nothing here hard-codes or logs it.
 */

import { WebSocket } from "ws";
import type { Frame } from "../../../shared/frame-protocol/index.js";
import { pullerEncode, pullerDecode } from "./frame-codec.js";
import { Heartbeat, realTimers, type TimerHandle, type TimerSource } from "./heartbeat.js";
import { backoffDelay } from "./backoff.js";

/** Operator-observable connection status (AC3). */
export type ChannelStatus = "disconnected" | "connecting" | "connected";

/** Channel configuration. All intervals are milliseconds. */
export interface ChannelConfig {
  /** Relay WebSocket URL the puller dials out to (e.g. ws://host:port). */
  readonly relayUrl: string;
  /** Static hop bearer from the secret store (never code/repo). */
  readonly bearer: string;
  /** Heartbeat Ping cadence (AC2). */
  readonly heartbeatIntervalMs: number;
  /** Window in which a Pong must arrive after a Ping (AC2 bound). */
  readonly heartbeatTimeoutMs: number;
  /** Floor reconnect delay (also the first reconnect delay). */
  readonly minReconnectMs: number;
  /** Ceiling reconnect delay (the curve flattens here). */
  readonly maxReconnectMs: number;
  /** Injectable timers (tests); defaults to the real Node timers. */
  readonly timers?: TimerSource;
}

/** Optional observer callbacks for status changes and inbound frames. */
export interface ChannelCallbacks {
  onStatus?: (status: ChannelStatus) => void;
  onFrame?: (frame: Frame) => void;
}

/**
 * Outbound channel. One instance owns one outbound link (plus its reconnect
 * loop). `start()` dials out; `stop()` tears down and stops reconnecting.
 */
export class OutboundChannel {
  private ws?: WebSocket;
  private heartbeat?: Heartbeat;
  private reconnectHandle?: TimerHandle;
  private status: ChannelStatus = "disconnected";
  private attempt = 0;
  private stopped = true;
  private dropGuard = false;
  private readonly timers: TimerSource;

  constructor(
    private readonly cfg: ChannelConfig,
    private readonly cb: ChannelCallbacks = {},
  ) {
    this.timers = cfg.timers ?? realTimers;
  }

  /** Current connection status (observable liveness, AC3). */
  getStatus(): ChannelStatus {
    return this.status;
  }

  /** Start dialling out and holding the line (idempotent). */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.dial();
  }

  /**
   * Send a frame to the relay. Returns true only when written to an open socket;
   * false (and a log line) when the link is down — the channel never silently
   * drops a frame without a trace, and never delivers one before auth completes.
   */
  send(frame: Frame): boolean {
    if (this.status !== "connected" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[channel] send while not connected — frame dropped");
      return false;
    }
    this.ws.send(pullerEncode(frame));
    return true;
  }

  /** Stop the channel: no further reconnects; tear down any open socket. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectHandle !== undefined) {
      this.timers.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
    this.stopHeartbeat();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close(1000);
    this.setStatus("disconnected");
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /** Open one outbound connection and wire its events. */
  private dial(): void {
    this.dropGuard = false;
    this.setStatus("connecting");
    console.log(`[channel] dialing ${this.cfg.relayUrl} (attempt ${this.attempt + 1})`);
    const ws = new WebSocket(this.cfg.relayUrl, [], {
      headers: { Authorization: `Bearer ${this.cfg.bearer}` },
    });
    this.ws = ws;
    ws.on("open", () => this.onOpen(ws));
    ws.on("pong", () => this.heartbeat?.notePong());
    ws.on("message", (data) => this.onMessage(data));
    // ws guarantees a 'close' after any 'error'; route through one drop path.
    ws.on("close", () => this.onDrop(ws));
    ws.on("error", (err) => console.warn(`[channel] socket error: ${err.message}`));
  }

  /** Upgrade succeeded — the relay accepted the bearer. Begin liveness checks. */
  private onOpen(ws: WebSocket): void {
    if (ws !== this.ws) return; // stale socket
    this.attempt = 0;
    this.setStatus("connected");
    this.stopHeartbeat();
    this.heartbeat = new Heartbeat(
      this.cfg.heartbeatIntervalMs,
      this.cfg.heartbeatTimeoutMs,
      () => ws.ping(),
      this.timers,
    );
    this.heartbeat.start(() => {
      console.warn("[channel] heartbeat missed — terminating link");
      ws.terminate(); // hard close → 'close' → onDrop → reconnect (AC2/AC3)
    });
  }

  /** Decode an inbound frame and forward it; a malformed frame is logged, not fatal. */
  private onMessage(data: unknown): void {
    const bytes = toUint8Array(data);
    let frame: Frame;
    try {
      frame = pullerDecode(bytes);
    } catch (e) {
      console.warn(`[channel] dropping malformed frame: ${(e as Error).message}`);
      return;
    }
    this.cb.onFrame?.(frame);
  }

  /** Connection lost (or never opened): schedule a bounded reconnect unless stopped. */
  private onDrop(ws: WebSocket): void {
    if (ws !== this.ws || this.dropGuard) return; // stale or already-handled drop
    this.dropGuard = true;
    this.stopHeartbeat();
    this.ws = undefined;
    if (this.stopped) {
      this.setStatus("disconnected");
      return;
    }
    const delay = backoffDelay(this.attempt, this.cfg.minReconnectMs, this.cfg.maxReconnectMs);
    this.attempt += 1;
    console.warn(`[channel] link down — reconnecting in ${delay}ms`);
    this.setStatus("disconnected");
    this.reconnectHandle = this.timers.setTimeout(() => this.dial(), delay);
  }

  private stopHeartbeat(): void {
    this.heartbeat?.stop();
    this.heartbeat = undefined;
  }

  private setStatus(next: ChannelStatus): void {
    if (next === this.status) return;
    this.status = next;
    console.log(`[channel] ${next}`);
    this.cb.onStatus?.(next);
  }
}

/** Coerce a ws message payload (Buffer | ArrayBuffer views) to Uint8Array. */
function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // ws emits Buffer by default in Node; reach its bytes as a last resort.
  return new Uint8Array(Buffer.from(data as Uint8Array));
}
