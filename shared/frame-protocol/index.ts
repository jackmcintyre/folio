/**
 * frame-protocol — versioned Relay↔Puller private channel codec (AD-16).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the wire format of the private
 * framed protocol over the persistent Relay↔Puller WebSocket (AD-15). Both
 * `relay/` and `puller/` consume it; shared conformance vectors (./vectors.ts)
 * are asserted against BOTH sides' codecs in CI, so the relay and puller cannot
 * ship incompatible wire formats that each look locally correct.
 *
 * Wire format v1 — one UTF-8 JSON object per frame (one WebSocket message):
 *   request:  { v, type:"request",  correlationId, idempotencyKey, size, body:<base64> }
 *   response: { v, type:"response", correlationId, size, result: Receipt | TypedError }
 *
 * `size` is the DECODED byteLen of the payload (base64/transport framing
 * excluded — AD-9); decoders assert it and reject on mismatch. The wire-shape
 * TYPES + token set live in ./types.ts (re-exported below); the base64 helpers
 * live in ./base64.ts. This file is the codec (encode/decode/framesEqual).
 */

export * from "./types.js";
import {
  FRAME_PROTOCOL_VERSION,
  type Frame,
  type FrameRequest,
  type FrameResponse,
  type FrameVersion,
  type Receipt,
  type TypedError,
} from "./types.js";

// ──────────────────────────────────────────────────────────────────────────
// Canonical codec — the executable definition of the v1 wire format.
//
// One frame = one UTF-8 JSON object. The request body (raw bytes) is carried
// base64 inside the JSON; `size` gives the DECODED length so a receiver can
// validate it decoded the right number of bytes (and so size limits are
// measured on payload bytes, not transport bytes — AD-9). Deterministic key
// ordering is enforced by constructing the envelope objects in a fixed order;
// JSON.stringify preserves string-key insertion order, so the wire bytes are
// stable across runs and engines (required for byte-exact conformance vectors).
// ──────────────────────────────────────────────────────────────────────────

/** Thrown when a frame cannot be decoded (version/shape/size mismatch). */
export class FrameDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameDecodeError";
  }
}

// --- base64 helpers (no Node Buffer: works on Cloudflare Workers + Node) ---
// Extracted to ./base64.ts to keep this module within the file-size ceiling.

import { base64ToBytes, bytesToBase64 } from "./base64.js";

// --- canonical JSON of a result (Receipt | TypedError) ---
// Stringify the result as-is; objects are constructed with fixed key order by
// the encoder, so this is deterministic.

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function resultCanonicalBytes(result: Receipt | TypedError): Uint8Array {
  return encodeUtf8(JSON.stringify(result));
}

interface WireRequestEnvelope {
  v: string;
  type: "request";
  correlationId: string;
  idempotencyKey: string;
  size: number;
  body: string;
}

interface WireResponseEnvelope {
  v: string;
  type: "response";
  correlationId: string;
  size: number;
  result: Receipt | TypedError;
}

type WireEnvelope = WireRequestEnvelope | WireResponseEnvelope;

/**
 * Encode a logical frame to its v1 wire bytes (one UTF-8 JSON object).
 * Deterministic: identical frames produce byte-identical wire output.
 */
export function encode(frame: Frame): Uint8Array {
  if (frame.type === "request") {
    const envelope: WireRequestEnvelope = {
      v: frame.v,
      type: "request",
      correlationId: frame.correlationId,
      idempotencyKey: frame.idempotencyKey,
      size: frame.body.byteLength,
      body: bytesToBase64(frame.body),
    };
    return encodeUtf8(JSON.stringify(envelope));
  }
  // response
  const resultBytes = resultCanonicalBytes(frame.result);
  if (resultBytes.byteLength !== frame.size) {
    // Programmer error: the caller built a response whose declared size does not
    // match its result. Surface loudly rather than emit a frame the peer rejects.
    throw new FrameDecodeError(
      `response frame size mismatch: declared ${frame.size}, ` +
        `result decoded ${resultBytes.byteLength}`,
    );
  }
  const envelope: WireResponseEnvelope = {
    v: frame.v,
    type: "response",
    correlationId: frame.correlationId,
    size: frame.size,
    result: frame.result,
  };
  return encodeUtf8(JSON.stringify(envelope));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Decode v1 wire bytes to a logical frame. Validates the version, the type
 * discriminator, and the declared `size` against the decoded byteLen. Throws
 * FrameDecodeError on any mismatch (a conformance-vector mismatch surfaces here
 * and fails CI).
 */
export function decode(wire: Uint8Array): Frame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(wire));
  } catch (e) {
    throw new FrameDecodeError(`frame is not valid JSON: ${(e as Error).message}`);
  }
  if (!isObject(parsed)) {
    throw new FrameDecodeError("frame envelope must be a JSON object");
  }
  const env = parsed as unknown as WireEnvelope;
  if (env.v !== FRAME_PROTOCOL_VERSION) {
    throw new FrameDecodeError(
      `frame version mismatch: expected "${FRAME_PROTOCOL_VERSION}", got ${JSON.stringify(env.v)}`,
    );
  }
  if (typeof env.correlationId !== "string") {
    throw new FrameDecodeError("frame missing string field: correlationId");
  }
  if (env.type === "request") return decodeRequest(env);
  if (env.type === "response") return decodeResponse(env);
  // Capture the raw discriminator before the union is narrowed away (so the
  // "unknown type" error message can still report what was received).
  throw new FrameDecodeError(
    `unknown frame type discriminator: ${JSON.stringify(String(parsed["type"] ?? ""))}`,
  );
}

/** Assert a numeric `size` field is present and finite, or throw. */
function requireSize(size: unknown, frameKind: string): asserts size is number {
  if (typeof size !== "number" || !Number.isFinite(size)) {
    throw new FrameDecodeError(`${frameKind} frame missing numeric field: size`);
  }
}

/** Decode + validate a request envelope (correlationId already checked). */
function decodeRequest(env: WireRequestEnvelope): FrameRequest {
  if (typeof env.idempotencyKey !== "string") {
    throw new FrameDecodeError("request frame missing string field: idempotencyKey");
  }
  if (typeof env.body !== "string") {
    throw new FrameDecodeError("request frame missing string field: body");
  }
  requireSize(env.size, "request");
  const body = base64ToBytes(env.body);
  if (body.byteLength !== env.size) {
    throw new FrameDecodeError(
      `request size mismatch: declared ${env.size}, decoded byteLen ${body.byteLength}`,
    );
  }
  return {
    v: env.v as FrameVersion,
    type: "request",
    correlationId: env.correlationId,
    idempotencyKey: env.idempotencyKey,
    body,
    size: env.size,
  };
}

/** Decode + validate a response envelope (correlationId already checked). */
function decodeResponse(env: WireResponseEnvelope): FrameResponse {
  if (!isObject(env.result)) {
    throw new FrameDecodeError("response frame missing object field: result");
  }
  requireSize(env.size, "response");
  const result = env.result as Receipt | TypedError;
  const decoded = resultCanonicalBytes(result).byteLength;
  if (decoded !== env.size) {
    throw new FrameDecodeError(
      `response size mismatch: declared ${env.size}, decoded byteLen ${decoded}`,
    );
  }
  return {
    v: env.v as FrameVersion,
    type: "response",
    correlationId: env.correlationId,
    result,
    size: env.size,
  };
}

/**
 * Deep-equality for frames (Uint8Array-aware). Used by the conformance harness
 * to assert decode(encode(f)) ≡ f and cross-side interop.
 */
export function framesEqual(a: Frame, b: Frame): boolean {
  if (a.type !== b.type) return false;
  if (a.v !== b.v || a.correlationId !== b.correlationId || a.size !== b.size) return false;
  if (a.type === "request" && b.type === "request") return requestsEqual(a, b);
  if (a.type === "response" && b.type === "response") {
    return JSON.stringify(a.result) === JSON.stringify(b.result);
  }
  return false;
}

/** Request-arm equality: idempotency key + byte-exact body (envelope fields
 *  already compared by the caller). */
function requestsEqual(a: FrameRequest, b: FrameRequest): boolean {
  if (a.idempotencyKey !== b.idempotencyKey) return false;
  if (a.body.byteLength !== b.body.byteLength) return false;
  for (let i = 0; i < a.body.byteLength; i++) {
    if (a.body[i] !== b.body[i]) return false;
  }
  return true;
}
