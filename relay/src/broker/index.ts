/**
 * relay/src/broker
 *
 * BrokerDO — the Durable Object that owns the Puller connection, correlation ids,
 * and epoch tags (AD-14, AD-18).
 *
 * Responsibilities:
 *   - Holds the single outbound WebSocket to the Puller (via Hibernation).
 *   - Assigns a correlation id per forwarded request (ULID, never reused — AD-18).
 *   - Maps each ack back to the right pending caller; drops stale-epoch acks.
 *   - On WebSocket drop: fails all in-flight callers with `puller_offline`.
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

export class BrokerDO implements DurableObject {
  constructor(_state: DurableObjectState, _env: unknown) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("BrokerDO: not implemented (Story 1.2+)", {
      status: 503,
    });
  }
}
