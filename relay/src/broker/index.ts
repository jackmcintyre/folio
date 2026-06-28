/**
 * broker — Durable Object: the single-Puller connection broker (AR-7, AD-13,
 * AD-14/AD-18).
 *
 * Public surface of the broker. The DECISION LOGIC lives in ./core.ts
 * (`BrokerCore`) — transport-agnostic so it is unit-testable under Node against
 * every acceptance criterion. The Cloudflare adapter that owns the real
 * (hibernatable) WebSocket and delegates to the core is `RelayBroker` in
 * ./durable-object.ts; it is exported from there (and named in
 * `relay/wrangler.toml`'s `[durable_objects]` binding), not re-exported here,
 * because it depends on the Workers runtime types that the Node-side build does
 * not load. The wire-format commitment point is ./frame-codec.ts.
 */

export { BrokerCore } from "./core.js";
export type { BrokerConnection, BrokerResult, AckOutcome } from "./core.js";
export { relayEncode, relayDecode } from "./frame-codec.js";
