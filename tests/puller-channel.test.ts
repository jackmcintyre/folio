/**
 * Puller outbound-channel tests — AC1, AC2, AC3, AC4 for Story 2.1
 * (Puller outbound channel with heartbeat and auto-reconnect).
 *
 * The relay stand-in is a REAL `ws` WebSocketServer on an ephemeral port; the
 * channel under test is the REAL outbound client. This is the "test client"
 * the dev notes name: every acceptance criterion is proven over real WebSocket
 * frames (connect, ping/pong, close, reconnect, refuse) — not mocks. Pure logic
 * (the backoff curve and the heartbeat bound) is proven separately with fake
 * timers, because the bound is the place a timing bug would hide.
 */

import { AddressInfo, WebSocketServer, type WebSocket as WsClient } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OutboundChannel,
  backoffDelay,
  createChannel,
  loadChannelEnv,
  Heartbeat,
  type ChannelCallbacks,
  type ChannelConfig,
  type ChannelStatus,
} from "../puller/src/channel/index.js";
import { encode, type Frame } from "../shared/frame-protocol/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CHANNEL_DIR = resolve(ROOT, "puller/src/channel");

// ─── timing helpers (real-clock integration tests) ──────────────────────────

/** Resolve after `ms` (real clock). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll `pred` every ~8ms until true or `timeoutMs` elapses; throws on timeout. */
async function sleepUntil(
  pred: () => boolean,
  timeoutMs: number,
  msg = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(8);
  }
  throw new Error(`sleepUntil timed out waiting for: ${msg}`);
}

// ─── relay stand-in (the "test client" — a real WS server) ───────────────────

interface Relay {
  url: string;
  server: WebSocketServer;
  /** Inbound messages the relay received from the puller, in order. */
  messages: Buffer[];
  /** Every server-side socket accepted (one per accepted upgrade). */
  sockets: WsClient[];
  /** Upgrades the relay REFUSED (bad/missing bearer) — AC4. */
  refused: number;
  close(): Promise<void>;
}

interface RelayOpts {
  /** When set, the relay requires `Authorization: Bearer <bearer>` (AC1/AC4). */
  bearer?: string;
  /** When false, the relay does NOT auto-pong → simulates a dead link (AC2). */
  autoPong?: boolean;
}

/** Start a real WS server on an ephemeral port as the relay stand-in. */
async function startRelay(opts: RelayOpts = {}): Promise<Relay> {
  const messages: Buffer[] = [];
  const sockets: WsClient[] = [];
  const refused = { n: 0 };
  const server = new WebSocketServer({
    port: 0,
    autoPong: opts.autoPong ?? true,
    verifyClient: (info, cb) => {
      if (opts.bearer === undefined) return cb(true);
      const ok = info.req.headers.authorization === `Bearer ${opts.bearer}`;
      if (!ok) refused.n += 1;
      cb(ok, ok ? undefined : 401);
    },
  });
  await new Promise<void>((res) => server.on("listening", () => res()));
  server.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (data) => messages.push(Buffer.from(data as Uint8Array)));
  });
  const addr = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${addr.port}`,
    server,
    messages,
    sockets,
    get refused() {
      return refused.n;
    },
    close: async () => {
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}

// ─── shared teardown — never leave a server/channel dangling ─────────────────

const openChannels: OutboundChannel[] = [];
const openRelays: Relay[] = [];
afterEach(async () => {
  for (const ch of openChannels) ch.stop();
  openChannels.length = 0;
  for (const r of openRelays) await r.close();
  openRelays.length = 0;
  vi.useRealTimers();
});

/** Build a fast-ticking channel config for the integration tests. */
function fastCfg(
  relay: Relay,
  bearer: string,
  overrides: Partial<ChannelConfig> = {},
): ChannelConfig {
  return {
    relayUrl: relay.url,
    bearer,
    heartbeatIntervalMs: 60,
    heartbeatTimeoutMs: 90,
    minReconnectMs: 25,
    maxReconnectMs: 120,
    ...overrides,
  };
}

/** Create a channel that records every status transition into `history`. */
function recordingChannel(cfg: ChannelConfig, history: ChannelStatus[]): OutboundChannel {
  const cb: ChannelCallbacks = { onStatus: (s) => history.push(s) };
  const ch = createChannel(cfg, cb);
  openChannels.push(ch);
  return ch;
}

// A clearly-fake test bearer (NOT a secret) — kept low-entropy on purpose so it
// can never be mistaken for a credential. gitleaks:allow
const GOOD_BEARER = "test-bearer-good";
const BAD_BEARER = "test-bearer-wrong";

// ────────────────────────────────────────────────────────────────────────────
// AC1 — outbound connect + bearer auth + pull-only.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — opens an outbound WS and authenticates the hop with its bearer", () => {
  it("connects outbound and reaches 'connected'", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, GOOD_BEARER), history);

    ch.start();
    await sleepUntil(() => history.includes("connected"), 4000, "connected");

    expect(ch.getStatus()).toBe("connected");
    // The channel dialled OUT to the relay: the relay accepted one socket.
    expect(relay.sockets.length).toBe(1);
  });

  it("presents the static bearer in the Authorization header on the upgrade", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, GOOD_BEARER), history);

    ch.start();
    await sleepUntil(() => history.includes("connected"), 4000, "connected");
    // verifyClient accepted the upgrade iff the bearer matched (AC1 auth).
    expect(relay.sockets.length).toBe(1);
    expect(relay.refused).toBe(0);
  });

  it("opens NO inbound listener — the channel is a client only (pull-only)", () => {
    // Structural: the channel source never constructs a server and never listens.
    const read = (name: string) => readFileSync(resolve(CHANNEL_DIR, name), "utf8");
    const files = ["index.ts", "connection.ts", "heartbeat.ts", "backoff.ts", "frame-codec.ts"];
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} must not start a server`).not.toMatch(/\bWebSocketServer\b/);
      expect(src, `${f} must not listen`).not.toMatch(/\.listen\s*\(/);
    }
  });

  it("encodes outbound frames through the versioned frame protocol", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, GOOD_BEARER), history);
    ch.start();
    await sleepUntil(() => history.includes("connected"), 4000, "connected");

    const body = new TextEncoder().encode("payload-bytes");
    const frame: Frame = {
      v: "1",
      type: "request",
      correlationId: "corr-ac1-abcdef",
      idempotencyKey: "idem-key-ac1-abcdef-0001", // fixture key matching the grammar (>=16 chars); not a secret gitleaks:allow
      body,
      size: body.byteLength,
    };
    expect(ch.send(frame)).toBe(true);
    await sleepUntil(() => relay.messages.length >= 1, 2000, "relay received frame");
    // The relay received exactly the canonical v1 wire encoding of the frame.
    expect(Array.from(relay.messages[0]!)).toEqual(Array.from(encode(frame)));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — heartbeat keeps it alive; a missed heartbeat is detected within a bound.
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — heartbeat ping/pong keeps the link alive across cycles", () => {
  it("stays connected across many heartbeat cycles when the relay pongs", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER, autoPong: true });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, GOOD_BEARER, { heartbeatIntervalMs: 40 }), history);
    ch.start();
    await sleepUntil(() => history.includes("connected"), 4000, "connected");

    // Let ~8 heartbeat cycles elapse (40ms each). Pings go out, pongs come back,
    // the miss window is cleared every cycle — the link must stay alive.
    await sleep(350);
    expect(ch.getStatus()).toBe("connected");
    // No drop/reconnect after the initial connect (no second 'connecting').
    const connectings = history.filter((s) => s === "connecting").length;
    expect(connectings).toBe(1);
  });

  it("detects a missed heartbeat and reconnects within the bounded window", async () => {
    // autoPong:false → the relay never answers the puller's pings, so the link
    // is silently dead from the puller's side. The heartbeat must declare it
    // dead within heartbeatTimeoutMs and the channel must reconnect (AC2/AC3).
    const relay = await startRelay({ bearer: GOOD_BEARER, autoPong: false });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const timeoutMs = 100;
    const ch = recordingChannel(
      fastCfg(relay, GOOD_BEARER, { heartbeatIntervalMs: 200, heartbeatTimeoutMs: timeoutMs }),
      history,
    );
    ch.start();
    await sleepUntil(() => history.includes("connected"), 4000, "initial connect");

    // The first ping fires on connect; with no pong, the miss fires at <=timeoutMs.
    const reconnectStartedAt = Date.now();
    await sleepUntil(
      () => history.filter((s) => s === "connecting").length >= 2,
      timeoutMs + 1000,
      "reconnect after missed heartbeat",
    );
    const elapsed = Date.now() - reconnectStartedAt;
    // Detected within a bounded interval (the miss window + modest slack) — never
    // unbounded. The slack covers the reconnect setTimeout + dial latency.
    expect(elapsed).toBeLessThan(timeoutMs + 1000);
    // The dead link was terminated: a 'disconnected' preceded the reconnect.
    const idx = history.lastIndexOf("connecting");
    expect(history[idx - 1]).toBe("disconnected");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC3 — bounded exponential backoff, re-auth on reconnect, observable status.
// ────────────────────────────────────────────────────────────────────────────
describe("AC3 — reconnects with bounded backoff, re-authenticates, observable status", () => {
  it("reconnects automatically after the relay drops the link", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, GOOD_BEARER), history);
    ch.start();
    await sleepUntil(() => history.includes("connected"), 4000, "first connect");

    // Server-initiated close → the puller must detect the drop and reconnect.
    for (const s of relay.sockets) s.close(1001);
    await sleepUntil(
      () => history.filter((s) => s === "connected").length >= 2,
      4000,
      "reconnect after drop",
    );
    expect(ch.getStatus()).toBe("connected");
  });

  it("re-authenticates on every reconnect (bearer presented again)", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, GOOD_BEARER), history);
    ch.start();
    await sleepUntil(() => history.includes("connected"), 4000, "first connect");
    const firstSockets = relay.sockets.length;

    for (const s of [...relay.sockets]) s.close(1001);
    await sleepUntil(() => relay.sockets.length > firstSockets, 4000, "second accepted upgrade");
    // Each accepted upgrade passed verifyClient (bearer matched). A reconnect
    // that failed to re-present the bearer would have been refused, not accepted.
    expect(relay.sockets.length).toBeGreaterThan(firstSockets);
    expect(relay.refused).toBe(0);
  });

  it("status is observable: transitions emit connected/disconnected/connecting", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, GOOD_BEARER), history);
    ch.start();
    await sleepUntil(() => history.includes("connected"), 4000, "connected");
    for (const s of relay.sockets) s.close(1001);
    await sleepUntil(() => history.includes("disconnected"), 2000, "disconnected observable");
    // The operator surface (onStatus) carried every transition in order.
    expect(history[0]).toBe("connecting");
    expect(history).toContain("connected");
    expect(history).toContain("disconnected");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC4 — invalid/missing bearer refused; no payload ever delivered.
// ────────────────────────────────────────────────────────────────────────────
describe("AC4 — invalid/missing bearer is refused and no payload is delivered", () => {
  it("refuses an invalid bearer at the upgrade (the relay never accepts it)", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, BAD_BEARER), history);
    ch.start();
    // The bad bearer is refused on every attempt; the channel never connects.
    await sleep(400);
    expect(ch.getStatus()).not.toBe("connected");
    expect(relay.sockets.length).toBe(0); // nothing accepted
    expect(relay.refused).toBeGreaterThan(0);
  });

  it("delivers no payload: send() is refused before the link is authenticated", async () => {
    const relay = await startRelay({ bearer: GOOD_BEARER });
    openRelays.push(relay);
    const history: ChannelStatus[] = [];
    const ch = recordingChannel(fastCfg(relay, BAD_BEARER), history);
    ch.start();
    await sleep(300);
    const body = new TextEncoder().encode("never-delivered");
    const frame: Frame = {
      v: "1",
      type: "request",
      correlationId: "corr-ac4-abcdef",
      idempotencyKey: "idem-key-ac4-abcdef-0001", // fixture key matching the grammar (>=16 chars); not a secret gitleaks:allow
      body,
      size: body.byteLength,
    };
    // Not connected → send() returns false and the relay receives nothing.
    expect(ch.send(frame)).toBe(false);
    expect(relay.messages.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Pure logic — the backoff curve (bounded, monotonic, clamped).
// ────────────────────────────────────────────────────────────────────────────
describe("backoff — bounded exponential curve (NFR-3)", () => {
  it("doubles the delay per attempt up to the cap", () => {
    expect(backoffDelay(0, 10, 1000)).toBe(10);
    expect(backoffDelay(1, 10, 1000)).toBe(20);
    expect(backoffDelay(2, 10, 1000)).toBe(40);
    expect(backoffDelay(3, 10, 1000)).toBe(80);
  });

  it("never exceeds the cap (the curve flattens)", () => {
    expect(backoffDelay(10, 10, 1000)).toBe(1000);
    expect(backoffDelay(50, 10, 1000)).toBe(1000);
    expect(backoffDelay(1000, 10, 1000)).toBe(1000);
  });

  it("clamps malformed inputs so the bound cannot be defeated", () => {
    expect(backoffDelay(-5, 10, 1000)).toBe(10); // negative attempt → attempt 0
    expect(backoffDelay(2, -10, 1000)).toBeLessThanOrEqual(1000); // negative min → 0
    // max below min is a misconfiguration: the ceiling is raised to the floor so
    // the delay can never be driven below the safe minimum by a bad max.
    expect(backoffDelay(2, 10, 5)).toBe(10);
    expect(Number.isFinite(backoffDelay(2, 10, Number.POSITIVE_INFINITY))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Pure logic — the heartbeat bound (missed detected within the window).
// Proven with fake timers because the bound is the place a timing bug hides.
// ────────────────────────────────────────────────────────────────────────────
describe("heartbeat — missed heartbeat detected within the bounded window (AC2)", () => {
  // The Heartbeat uses the global timers by default; vi.useFakeTimers replaces
  // those globals, so the cadence and the miss window advance in real time
  // order — the property under test (the bound) is exactly what a fake clock
  // that fires everything at once would hide.
  it("fires onMiss once when no pong arrives within the window", () => {
    vi.useFakeTimers();
    try {
      let missed = 0;
      let pings = 0;
      // Long interval so only the first ping + its miss window are in play.
      const hb = new Heartbeat(1000, 100, () => pings++);
      hb.start(() => missed++);
      expect(pings).toBe(1); // first ping sent immediately
      vi.advanceTimersByTime(99); // just before the 100ms miss window
      expect(missed).toBe(0);
      vi.advanceTimersByTime(2); // cross the window with no pong
      expect(missed).toBe(1); // detected within the bounded interval
      hb.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a timely pong clears the miss window (heartbeat keeps the link alive)", () => {
    vi.useFakeTimers();
    try {
      let missed = 0;
      const hb = new Heartbeat(1000, 100, () => {});
      hb.start(() => missed++);
      vi.advanceTimersByTime(50); // before the window
      hb.notePong(); // pong arrived → clears the pending miss
      vi.advanceTimersByTime(200); // cross where the miss would have fired
      expect(missed).toBe(0);
      hb.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() cancels any pending miss window (no fire after stop)", () => {
    vi.useFakeTimers();
    try {
      let missed = 0;
      const hb = new Heartbeat(1000, 100, () => {});
      hb.start(() => missed++);
      hb.stop();
      vi.advanceTimersByTime(500); // past where the miss window would fire
      expect(missed).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Config — the bearer comes from the secret store (env), never code/repo.
// ────────────────────────────────────────────────────────────────────────────
describe("config — bearer sourced from the secret store, never code/repo", () => {
  const ENV_KEYS = ["FOLIO_PULLER_BEARER", "FOLIO_RELAY_URL", "FOLIO_RELAY_PORT"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("requires FOLIO_PULLER_BEARER (the hop is never unauthenticated)", () => {
    process.env.FOLIO_RELAY_URL = "ws://localhost:9000";
    expect(() => loadChannelEnv()).toThrow(/FOLIO_PULLER_BEARER/);
  });

  it("uses FOLIO_RELAY_URL when set", () => {
    process.env.FOLIO_PULLER_BEARER = "from-secret-store"; // gitleaks:allow
    process.env.FOLIO_RELAY_URL = "ws://relay.example:7000";
    expect(loadChannelEnv()).toMatchObject({
      relayUrl: "ws://relay.example:7000",
      bearer: "from-secret-store",
    });
  });

  it("derives the relay URL from FOLIO_RELAY_PORT when URL is unset", () => {
    process.env.FOLIO_PULLER_BEARER = "from-secret-store"; // gitleaks:allow
    process.env.FOLIO_RELAY_PORT = "9123";
    expect(loadChannelEnv().relayUrl).toBe("ws://localhost:9123");
  });

  it("applies safe defaults for the heartbeat and reconnect curves", () => {
    process.env.FOLIO_PULLER_BEARER = "from-secret-store"; // gitleaks:allow
    process.env.FOLIO_RELAY_URL = "ws://localhost:9000";
    const cfg = loadChannelEnv();
    expect(cfg.heartbeatIntervalMs).toBeGreaterThan(0);
    expect(cfg.heartbeatTimeoutMs).toBeGreaterThan(0);
    expect(cfg.minReconnectMs).toBeGreaterThan(0);
    expect(cfg.maxReconnectMs).toBeGreaterThanOrEqual(cfg.minReconnectMs);
  });
});
