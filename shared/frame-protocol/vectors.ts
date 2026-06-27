/**
 * Conformance vectors for the frame-protocol spec (AD-16 / Story 1.7 AC2).
 *
 * These are the SHARED golden vectors asserted against BOTH the relay-side and
 * puller-side codecs in CI (see tests/frame-protocol-conformance.test.ts). They
 * pin the exact v1 wire bytes for a representative spread of frames, so:
 *
 *   - a change to EITHER codec that alters the wire format fails CI, and
 *   - the relay and puller cannot drift apart on the wire (both must reproduce
 *     these bytes and round-trip them back to the same frame).
 *
 * `expectedWire` is the canonical UTF-8 JSON the v1 codec emits, captured once
 * (golden master) and frozen here as data — NOT recomputed from the codec. So a
 * codec change that produces different bytes breaks the equality assertion even
 * if encode/decode still round-trip internally. This is the conformance teeth:
 * the format is pinned by an independent artefact, not by the codec's own
 * self-consistency.
 *
 * Spread: a minimal request, an empty-body request, a request with non-ASCII /
 * high-bit bytes (base64 path), a successful Receipt response, and a TypedError
 * response (covering both arms of `Receipt | TypedError`).
 */

import type { Frame, FrameRequest, FrameResponse, Receipt, TypedError } from "./index.js";
import { FRAME_PROTOCOL_VERSION, RECEIPT_VERSION } from "./index.js";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Decoded byteLen of a result's canonical JSON (AD-9 — the value the response
 *  `size` field must carry). Mirrors the spec's definition on purpose so a
 *  vector is self-describing. */
function resultByteLen(result: Receipt | TypedError): number {
  return utf8(JSON.stringify(result)).length;
}

const receipt: Receipt = {
  v: RECEIPT_VERSION,
  path: "inbox",
  filename: "2026-06-23-143000-note.md",
  timestamp: "2026-06-23T14:30:00+10:00",
};

const typedError: TypedError = {
  error: "payload_too_large",
  message: "body exceeds limit",
};

/** A request vector frame (size derived from the body, as the encoder does). */
function request(
  id: string,
  correlationId: string,
  idempotencyKey: string,
  body: Uint8Array,
): FrameRequest {
  return {
    v: FRAME_PROTOCOL_VERSION,
    type: "request",
    correlationId,
    idempotencyKey,
    body,
    size: body.byteLength,
  };
}

/** A response vector frame (size derived from the result's canonical bytes). */
function response(id: string, correlationId: string, result: Receipt | TypedError): FrameResponse {
  return {
    v: FRAME_PROTOCOL_VERSION,
    type: "response",
    correlationId,
    result,
    size: resultByteLen(result),
  };
}

export interface ConformanceVector {
  /** Stable id used in test output and failure messages. */
  id: string;
  /** What this vector exercises. */
  description: string;
  /** The logical frame the codec must encode from / decode to. */
  frame: Frame;
  /** The exact v1 wire bytes (as a UTF-8 JSON string) the codec must produce.
   *  Frozen — a codec that emits anything else fails conformance. */
  expectedWire: string;
}

export const CONFORMANCE_VECTORS: readonly ConformanceVector[] = [
  {
    id: "req-minimal",
    description: "minimal request with a small text body (base64 path)",
    frame: request("req-minimal", "corr-001", "idem-001", utf8("hello")),
    expectedWire:
      '{"v":"1","type":"request","correlationId":"corr-001","idempotencyKey":"idem-001","size":5,"body":"aGVsbG8="}',
  },
  {
    id: "req-empty",
    description: "request with an empty body (zero-byte payload)",
    frame: request("req-empty", "corr-002", "idem-002", new Uint8Array(0)),
    expectedWire:
      '{"v":"1","type":"request","correlationId":"corr-002","idempotencyKey":"idem-002","size":0,"body":""}',
  },
  {
    id: "req-binary",
    description: "request with high-bit / 0x00 bytes (non-ASCII base64 path)",
    frame: request("req-binary", "corr-003", "idem-003", new Uint8Array([0, 1, 2, 254, 255, 128])),
    expectedWire:
      '{"v":"1","type":"request","correlationId":"corr-003","idempotencyKey":"idem-003","size":6,"body":"AAEC/v+A"}',
  },
  {
    id: "res-receipt",
    description: "successful response carrying a Receipt (AD-2)",
    frame: response("res-receipt", "corr-001", receipt),
    expectedWire:
      '{"v":"1","type":"response","correlationId":"corr-001","size":103,"result":{"v":"1","path":"inbox","filename":"2026-06-23-143000-note.md","timestamp":"2026-06-23T14:30:00+10:00"}}',
  },
  {
    id: "res-typed-error",
    description: "failure response carrying a TypedError (AD-8 token set)",
    frame: response("res-typed-error", "corr-004", typedError),
    expectedWire:
      '{"v":"1","type":"response","correlationId":"corr-004","size":60,"result":{"error":"payload_too_large","message":"body exceeds limit"}}',
  },
];
