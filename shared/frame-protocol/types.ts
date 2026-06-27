/**
 * frame-protocol types — the versioned wire-shape definitions (AD-16).
 *
 * The pinned vocabulary of the Relay↔Puller channel: the envelope/Receipt
 * versions, the canonical typed-error token set (AD-8), the Receipt shape
 * (AD-2), and the request/response frame interfaces. Split out from the codec
 * (./index.ts) so each module stays within the file-size ceiling; ./index.ts
 * re-exports everything here, so the public import surface is unchanged.
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
// Typed-error contract (AD-8) — canonical, pinned token set. Tokens propagate
// across the hop unchanged. The full single-envelope RENDERER lands in AD-17;
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
 * (AD-21).
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
// Each carries an explicit `type` discriminator and a `size` (decoded byteLen).
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
