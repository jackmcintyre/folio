/**
 * RelayBackend — the v1 Backend adapter that delivers a Filing to the Puller
 * over the private framed protocol (AD-1, AD-2, AD-15/AD-16; FR-18; Story 2.3 AC2).
 *
 * This is the concrete Backend that sits behind the `deliver()` port today: the
 * handler calls `deliver(payload, idempotencyKey)`, the port routes to this
 * adapter, and this adapter MARSHALS the payload onto the versioned frame
 * protocol and forwards it via the Durable Object broker (the Puller hop). The
 * Receipt or typed error the Puller produces crosses back unchanged (AD-4/AD-8)
 * — this adapter synthesises nothing.
 *
 * The DO/WebSocket plumbing is abstracted behind `FilingForwarder` so this
 * adapter is unit-testable under Node against a real `BrokerCore`: the test
 * proves the payload is marshalled into a `FRAME_PROTOCOL_VERSION` request frame
 * carrying the idempotency key as a SEPARATE field (AD-5/AD-19), not inside the
 * body. The Worker entry (../transport/index.ts) supplies the production
 * forwarder that fetches the bound DO stub.
 *
 * BODY MARSHALLING (Relay→Puller contract): the frame body is the UTF-8 JSON
 * encoding of `{ content, slug, extension }` — the frame protocol carries `body`
 * as opaque bytes (shared/frame-protocol), so the meaning of those bytes is
 * pinned HERE. The Puller (Epic 3) decodes this same shape to write the file and
 * derive its filename; `decodePayloadBody` is the canonical inverse it mirrors.
 */

import type { Backend, DeliverPayload, DeliverResult } from "./index.js";

/**
 * The minimal contract this adapter needs to reach the Puller: forward already-
 * marshalled body bytes under an idempotency key and resolve with the Filing's
 * outcome. The production implementation fetches the DO broker stub; tests wire a
 * real `BrokerCore` so the frame-protocol marshalling is exercised end-to-end.
 */
export interface FilingForwarder {
  forward(body: Uint8Array, idempotencyKey: string): Promise<DeliverResult>;
}

/** The on-wire body shape: the `file` payload, minus the idempotency key. */
interface PayloadEnvelope {
  readonly content: string;
  readonly slug: string;
  readonly extension: string;
}

/**
 * Marshal a `deliver()` payload into the frame body bytes (UTF-8 JSON of
 * `{ content, slug, extension }`). The idempotency key is NOT part of the body —
 * it travels as a separate frame field (AD-5/AD-19). Keys are emitted in a fixed
 * order so the encoding is deterministic.
 */
export function encodePayloadBody(payload: DeliverPayload): Uint8Array {
  const envelope: PayloadEnvelope = {
    content: payload.content,
    slug: payload.slug,
    extension: payload.extension,
  };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

/**
 * Inverse of `encodePayloadBody`: decode frame body bytes back to the `file`
 * payload. This is the canonical reader the Puller (Epic 3) mirrors; co-locating
 * it with the encoder keeps the two halves of the body contract in one place.
 * Throws on bytes that are not the pinned envelope shape.
 */
export function decodePayloadBody(body: Uint8Array): DeliverPayload {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("payload body must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj["content"] !== "string" ||
    typeof obj["slug"] !== "string" ||
    typeof obj["extension"] !== "string"
  ) {
    throw new Error("payload body must carry string content, slug, and extension");
  }
  return { content: obj["content"], slug: obj["slug"], extension: obj["extension"] };
}

/**
 * The v1 Relay Backend: marshal the payload, forward it to the Puller via the
 * broker, and return the Puller's Receipt or typed error verbatim.
 */
export class RelayBackend implements Backend {
  constructor(private readonly forwarder: FilingForwarder) {}

  deliver(payload: DeliverPayload, idempotencyKey: string): Promise<DeliverResult> {
    const body = encodePayloadBody(payload);
    return this.forwarder.forward(body, idempotencyKey);
  }
}
