/**
 * frame-protocol — versioned Relay↔Puller private channel spec (AD-16).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the wire format of the private
 * framed protocol that runs over the persistent Relay↔Puller WebSocket (AD-15).
 * Both `relay/` and `puller/` consume this spec; shared conformance vectors
 * (see ./vectors.ts) are asserted against BOTH sides' codecs in CI, so the relay
 * and puller cannot ship incompatible wire formats that each look locally
 * correct (AD-16's whole purpose).
 *
 * Wire format v1 — one UTF-8 JSON object per frame (one WebSocket message):
 *   request:  { v, type:"request",  correlationId, idempotencyKey, size, body:<base64> }
 *   response: { v, type:"response", correlationId, size, result: Receipt | TypedError }
 *
 * `size` is the DECODED byteLen of the frame's payload at both layers — i.e. the
 * base64/transport framing is excluded from the measurement (AD-9). For a
 * request, size = the byte length of the decoded body (the file payload). For a
 * response, size = the byte length of the canonical UTF-8 JSON serialisation of
 * the result (Receipt | TypedError). Decoders assert the declared size against
 * the decoded length and reject on mismatch.
 *
 * This story (1.7) ships the spec + the conformance-vector harness. The
 * Receipt/TypedError SHAPES are defined here (the response frame carries them),
 * but their full behaviour lands in their owning stories (Receipt minting in the
 * backend stub / write path; the canonical envelope renderer in AD-17). The
 * codecs are real and exercised by the conformance vectors; the per-side relay
 * and puller codec modules (relay/src/broker, puller/src/channel) are thin
 * commitment-point stubs that delegate here until Epic 2 wires the real
 * transport-integrated codecs — which must still pass these vectors.
 */

// ──────────────────────────────────────────────────────────────────────────
// Versioning — "Contract + frame protocol + Receipt + token set each carry an
// explicit version field" (Consistency Conventions). The frame envelope carries
// its own version; the Receipt carries its own.
// ──────────────────────────────────────────────────────────────────────────

/** Version of the frame ENVELOPE (the wire shape below). Bump on any
 *  breaking change to the frame structure. */
export const FRAME_PROTOCOL_VERSION = "1" as const;
export type FrameVersion = typeof FRAME_PROTOCOL_VERSION;

/** Version of the Receipt payload (AD-2). The Receipt is a pinned, versioned
 *  shape, minted once by the Puller and immutable thereafter. */
export const RECEIPT_VERSION = "1" as const;
export type ReceiptVersion = typeof RECEIPT_VERSION;

// ──────────────────────────────────────────────────────────────────────────
// Typed-error contract (AD-8) — canonical, pinned token set.
// The token set is part of the versioned contract; tokens propagate across the
// hop unchanged. The full single-envelope RENDERER lands in AD-17 (story 2-5);
// here we only pin the token set + the minimal on-wire shape the response frame
// carries.
// ──────────────────────────────────────────────────────────────────────────

export const ERROR_TOKENS = [
  "unauthorized",
  "puller_offline",
  "payload_too_large",
  "rate_limited",
  "invalid_path",
  "integrity_failed",
  "write_failed",
  "idempotency_conflict",
] as const;

export type ErrorToken = (typeof ERROR_TOKENS)[number];

/** A value is an ErrorToken iff it is a member of the pinned set (AD-8). */
export function isErrorToken(value: unknown): value is ErrorToken {
  return typeof value === "string" && (ERROR_TOKENS as readonly string[]).includes(value);
}

/**
 * TypedError — the minimal on-wire shape a response frame carries when the
 * Filing failed. `error` is the canonical token (AD-8); `message` is optional
 * human-readable detail and MUST NEVER carry body content or content fragments
 * (AD-21). The canonical typed-envelope RENDERER (AD-17) is a later story; this
 * is the shape the frame layer agrees on today.
 */
export interface TypedError {
  error: ErrorToken;
  message?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Receipt (AD-2) — { v, path (relative to Target), filename, timestamp }.
// Puller-minted once, immutable thereafter; no layer reshapes it.
// ──────────────────────────────────────────────────────────────────────────

export interface Receipt {
  v: ReceiptVersion;
  /** Path relative to the Target directory (never absolute, never body content). */
  path: string;
  /** Filename YYYY-MM-DD-HHmmss-<slug>.<ext>, Australia/Sydney tz. */
  filename: string;
  /** ISO-8601 with offset, e.g. 2026-06-23T14:30:00+10:00. */
  timestamp: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Frames (AC1 / AD-16).
//   request  : { v, type, correlationId, idempotencyKey, body }
//   response : { v, type, correlationId, Receipt | TypedError }
// Each carries an explicit `type` discriminator and a `size` expressed as
// decoded byteLen.
// ──────────────────────────────────────────────────────────────────────────

/** Explicit type discriminator on every frame (AD-16). */
export type FrameType = "request" | "response";

/**
 * Request frame (AC1): `{ v, type, correlationId, idempotencyKey, body }`.
 * `body` is the file payload, carried as bytes. `size` is the decoded byteLen of
 * body (transport/base64 framing excluded — AD-9).
 */
export interface FrameRequest {
  v: FrameVersion;
  type: "request";
  correlationId: string;
  idempotencyKey: string;
  body: Uint8Array;
  /** Decoded byteLen of `body` (AD-9). */
  size: number;
}

/**
 * Response frame (AC1): `{ v, type, correlationId, Receipt | TypedError }`.
 * The Receipt|TypedError occupies the result position. `size` is the decoded
 * byteLen of the canonical UTF-8 JSON serialisation of the result.
 */
export interface FrameResponse {
  v: FrameVersion;
  type: "response";
  correlationId: string;
  result: Receipt | TypedError;
  /** Decoded byteLen of the serialised result (AD-9). */
  size: number;
}

export type Frame = FrameRequest | FrameResponse;

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

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;
    out += B64_CHARS[b0 >> 2]!;
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += i + 1 < len ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)]! : "=";
    out += i + 2 < len ? B64_CHARS[b2 & 0x3f]! : "=";
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  // Process in 4-char groups over the ORIGINAL string (padding inclusive) so the
  // output-length calc is correct: outLen = len*3/4 - padChars.
  const len = b64.length;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const outLen = (len * 3) / 4 - pad;
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const ch0 = b64.charAt(i);
    const ch1 = b64.charAt(i + 1);
    const ch2 = b64.charAt(i + 2);
    const ch3 = b64.charAt(i + 3);
    const c0 = ch0 === "" ? 0 : B64_CHARS.indexOf(ch0);
    const c1 = ch1 === "" ? 0 : B64_CHARS.indexOf(ch1);
    const c2 = ch2 === "" || ch2 === "=" ? -1 : B64_CHARS.indexOf(ch2);
    const c3 = ch3 === "" || ch3 === "=" ? -1 : B64_CHARS.indexOf(ch3);
    out[p++] = (c0 << 2) | (c1 >> 4);
    if (c2 !== -1) out[p++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 !== -1) out[p++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}

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
  // Capture the raw discriminator before the union is narrowed away below (so
  // the "unknown type" error message can still report what was received).
  const rawType = String(parsed["type"] ?? "");
  if (env.v !== FRAME_PROTOCOL_VERSION) {
    throw new FrameDecodeError(
      `frame version mismatch: expected "${FRAME_PROTOCOL_VERSION}", got ${JSON.stringify(env.v)}`,
    );
  }
  if (typeof env.correlationId !== "string") {
    throw new FrameDecodeError("frame missing string field: correlationId");
  }

  if (env.type === "request") {
    if (typeof env.idempotencyKey !== "string") {
      throw new FrameDecodeError("request frame missing string field: idempotencyKey");
    }
    if (typeof env.body !== "string") {
      throw new FrameDecodeError("request frame missing string field: body");
    }
    if (typeof env.size !== "number" || !Number.isFinite(env.size)) {
      throw new FrameDecodeError("request frame missing numeric field: size");
    }
    const body = base64ToBytes(env.body);
    if (body.byteLength !== env.size) {
      throw new FrameDecodeError(
        `request size mismatch: declared ${env.size}, decoded byteLen ${body.byteLength}`,
      );
    }
    return {
      v: env.v,
      type: "request",
      correlationId: env.correlationId,
      idempotencyKey: env.idempotencyKey,
      body,
      size: env.size,
    };
  }

  if (env.type === "response") {
    if (!isObject(env.result)) {
      throw new FrameDecodeError("response frame missing object field: result");
    }
    if (typeof env.size !== "number" || !Number.isFinite(env.size)) {
      throw new FrameDecodeError("response frame missing numeric field: size");
    }
    const result = env.result as Receipt | TypedError;
    const decoded = resultCanonicalBytes(result).byteLength;
    if (decoded !== env.size) {
      throw new FrameDecodeError(
        `response size mismatch: declared ${env.size}, decoded byteLen ${decoded}`,
      );
    }
    return {
      v: env.v,
      type: "response",
      correlationId: env.correlationId,
      result,
      size: env.size,
    };
  }

  throw new FrameDecodeError(`unknown frame type discriminator: ${JSON.stringify(rawType)}`);
}

/**
 * Deep-equality for frames (Uint8Array-aware). Used by the conformance harness
 * to assert decode(encode(f)) ≡ f and cross-side interop.
 */
export function framesEqual(a: Frame, b: Frame): boolean {
  if (a.type !== b.type) return false;
  if (a.v !== b.v || a.correlationId !== b.correlationId || a.size !== b.size) return false;
  if (a.type === "request" && b.type === "request") {
    if (a.idempotencyKey !== b.idempotencyKey) return false;
    if (a.body.byteLength !== b.body.byteLength) return false;
    for (let i = 0; i < a.body.byteLength; i++) {
      if (a.body[i] !== b.body[i]) return false;
    }
    return true;
  }
  if (a.type === "response" && b.type === "response") {
    return JSON.stringify(a.result) === JSON.stringify(b.result);
  }
  return false;
}
