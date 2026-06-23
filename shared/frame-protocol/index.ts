/**
 * shared/frame-protocol
 *
 * Versioned Relay↔Puller frame protocol (AD-16).
 *
 * Both relay/src/broker and puller/src/channel import from here.
 * Conformance vectors in this module are asserted on both sides in CI.
 *
 * Protocol version: 1
 *
 * Request frame (Relay → Puller):
 *   { v, type: "request", correlationId, idempotencyKey, body, byteLen }
 *
 * Response frame (Puller → Relay):
 *   { v, type: "receipt",   correlationId, receipt: Receipt }
 *   { v, type: "error",     correlationId, error: TypedError }
 *
 * Frame discipline (AD-16, AD-18):
 *   - `v` is checked on receipt; mismatch → drop + log.
 *   - `correlationId` is a ULID (never reused, never a per-connection counter).
 *   - `byteLen` is the decoded payload length in bytes (transport framing excluded).
 */

export const FRAME_PROTOCOL_VERSION = 1 as const;

// ── Request ────────────────────────────────────────────────────────────────

export interface RequestFrame {
  v: typeof FRAME_PROTOCOL_VERSION;
  type: "request";
  /** ULID — assigned by the DO, echoed on ack (AD-14, AD-18). */
  correlationId: string;
  /** Validated idempotency key (grammar per AD-19). */
  idempotencyKey: string;
  /** Base64-encoded payload body. */
  body: string;
  /** Decoded byte length of the payload (transport framing excluded — AD-9). */
  byteLen: number;
  /** Optional filename hint from the caller. */
  filename?: string;
}

// ── Response ───────────────────────────────────────────────────────────────

/** Versioned Receipt shape (AD-2).  Minted by the Puller; immutable thereafter. */
export interface Receipt {
  v: 1;
  /** Path relative to the Target directory. */
  path: string;
  /** Final filename: YYYY-MM-DD-HHmmss-<slug>.<ext>, Australia/Sydney tz (AD-7). */
  filename: string;
  /** ISO-8601 with UTC offset. */
  timestamp: string;
}

/** Canonical typed-error token set (AD-8). */
export type TypedErrorToken =
  | "unauthorized"
  | "puller_offline"
  | "payload_too_large"
  | "rate_limited"
  | "invalid_path"
  | "integrity_failed"
  | "write_failed"
  | "idempotency_conflict";

export interface TypedError {
  token: TypedErrorToken;
  /** Human-readable detail — never included in logs or traces (AD-21). */
  message?: string;
}

export interface ReceiptFrame {
  v: typeof FRAME_PROTOCOL_VERSION;
  type: "receipt";
  correlationId: string;
  receipt: Receipt;
}

export interface ErrorFrame {
  v: typeof FRAME_PROTOCOL_VERSION;
  type: "error";
  correlationId: string;
  error: TypedError;
}

export type ResponseFrame = ReceiptFrame | ErrorFrame;

// ── Conformance vectors ────────────────────────────────────────────────────
//
// Minimal golden fixtures used by tests on both relay and puller sides (AD-16).
// Each vector is a pair of [encoded JSON string, expected parsed shape].

export const CONFORMANCE_REQUEST_VECTOR: RequestFrame = {
  v: 1,
  type: "request",
  correlationId: "01HVXXXXXXXXXXXXXXXXXXXXXXXXXX",
  idempotencyKey: "test-key-001",
  body: "aGVsbG8=",
  byteLen: 5,
  filename: "hello.md",
};

export const CONFORMANCE_RECEIPT_VECTOR: ReceiptFrame = {
  v: 1,
  type: "receipt",
  correlationId: "01HVXXXXXXXXXXXXXXXXXXXXXXXXXX",
  receipt: {
    v: 1,
    path: "2026-06-23-100000-hello.md",
    filename: "2026-06-23-100000-hello.md",
    timestamp: "2026-06-23T10:00:00+10:00",
  },
};

export const CONFORMANCE_ERROR_VECTOR: ErrorFrame = {
  v: 1,
  type: "error",
  correlationId: "01HVXXXXXXXXXXXXXXXXXXXXXXXXXX",
  error: { token: "write_failed", message: "conformance test" },
};
