/**
 * channel — the puller's outbound link to the relay (AD-15 / AD-16, Story 2.1).
 *
 * Public surface for the outbound WebSocket client: an outbound-only dialer that
 * authenticates the hop with a static bearer, holds the line open with a
 * heartbeat, and reconnects with bounded exponential backoff. See ./connection.ts
 * for the lifecycle; ./frame-codec.ts for the wire format commitment; ./heartbeat.ts
 * and ./backoff.ts for the liveness/backoff curves.
 *
 * The bearer comes from the secret store via `loadChannelEnv()` — it is NEVER
 * hard-coded or committed. The channel logs status transitions so an operator
 * can see liveness before a Filing is attempted (AC3).
 */

export {
  OutboundChannel,
  type ChannelStatus,
  type ChannelConfig,
  type ChannelCallbacks,
} from "./connection.js";
export { Heartbeat, type TimerSource, type TimerHandle } from "./heartbeat.js";
export { backoffDelay } from "./backoff.js";

import type { ChannelCallbacks, ChannelConfig } from "./connection.js";
import { OutboundChannel } from "./connection.js";

/** Defaults for the heartbeat and reconnect curves (NFR-2/NFR-3). */
const DEFAULTS = {
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 10_000,
  minReconnectMs: 1_000,
  maxReconnectMs: 30_000,
} as const;

/** Read a required string env var or throw a clear, named error. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Puller channel: required environment variable ${name} is not set. ` +
        "The hop bearer and relay URL must come from the secret store / env, " +
        "never code or repo. Source scripts/dev-env.sh before starting the puller.",
    );
  }
  return value;
}

/** Read an optional positive-integer env var, or return the provided default. */
function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return n;
}

/**
 * Resolve the channel config from the environment (secret store).
 *
 * `FOLIO_RELAY_URL` wins; otherwise the URL is derived from `FOLIO_RELAY_PORT`
 * (the dev server). `FOLIO_PULLER_BEARER` is ALWAYS required — the hop is never
 * unauthenticated, and the bearer is never read from code or repo.
 */
export function loadChannelEnv(): ChannelConfig {
  const bearer = requiredEnv("FOLIO_PULLER_BEARER");
  const relayUrl =
    process.env.FOLIO_RELAY_URL ??
    (process.env.FOLIO_RELAY_PORT ? `ws://localhost:${process.env.FOLIO_RELAY_PORT}` : undefined);
  if (!relayUrl) {
    throw new Error(
      "Puller channel: set FOLIO_RELAY_URL (or FOLIO_RELAY_PORT to derive it) " +
        "so the puller knows where to dial out.",
    );
  }
  return {
    relayUrl,
    bearer,
    heartbeatIntervalMs: optionalInt("FOLIO_HEARTBEAT_INTERVAL_MS", DEFAULTS.heartbeatIntervalMs),
    heartbeatTimeoutMs: optionalInt("FOLIO_HEARTBEAT_TIMEOUT_MS", DEFAULTS.heartbeatTimeoutMs),
    minReconnectMs: optionalInt("FOLIO_RECONNECT_MIN_MS", DEFAULTS.minReconnectMs),
    maxReconnectMs: optionalInt("FOLIO_RECONNECT_MAX_MS", DEFAULTS.maxReconnectMs),
  };
}

/** Construct an outbound channel from a resolved config. */
export function createChannel(cfg: ChannelConfig, cb?: ChannelCallbacks): OutboundChannel {
  return new OutboundChannel(cfg, cb);
}
