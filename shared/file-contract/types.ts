/**
 * file-contract types — the pinned, versioned `file` tool surface (FR-1, FR-3,
 * AD-2, AD-8, AD-19).
 *
 * The frozen vocabulary of the contract: the version pin, the idempotency-key
 * and Receipt-timestamp grammars, the canonical eight typed-error tokens, the
 * Receipt/TypedError shapes, and the published input-schema descriptor. Split
 * out from the validators/parsers (./index.ts) so each module stays within the
 * file-size ceiling; ./index.ts re-exports everything here, so the public import
 * surface is unchanged. Every export here is part of the versioned contract — an
 * incompatible change MUST bump `FILE_CONTRACT_VERSION` (caught by the contract
 * test, Story 1.5 AC3).
 */

// Version (FR-3 / AC1): explicit identifier clients/tests pin to. Single integer,
// stringified (mirrors the frame-protocol version convention).
export const FILE_CONTRACT_VERSION = "1" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency-key grammar (AD-19 / AC2). Validated at BOTH ends; a malformed key
// is rejected with `invalid_path` before the durable store is touched. The store
// handle is a HASH of the validated key, never the raw key as a path. The grammar
// blocks traversal (URL-safe charset only), preserves case-distinctness, and
// bounds length 16–128.
// ─────────────────────────────────────────────────────────────────────────────
export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

// Receipt timestamp grammar (AC1): ISO-8601 with a numeric UTC offset
// (`[+-]HH:MM`), e.g. `2026-06-27T14:30:00+10:00`. Puller-minted in
// Australia/Sydney time — always a real local offset, never a bare `Z`.
// Fractional seconds permitted.
export const RECEIPT_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Typed-error token set (AD-8 / AC1): the canonical EIGHT tokens, part of the
// versioned contract; tokens propagate across the Relay hop unchanged.
// `idempotency_conflict` extends the PRD §3 set by one (operator-confirmed
// 2026-06-23): a same-key retry whose content DIFFERS from the original Filing.
// ─────────────────────────────────────────────────────────────────────────────
export const TYPED_ERROR_TOKENS = [
  "unauthorized",
  "puller_offline",
  "payload_too_large",
  "rate_limited",
  "invalid_path",
  "integrity_failed",
  "write_failed",
  "idempotency_conflict",
] as const;
export type TypedErrorToken = (typeof TYPED_ERROR_TOKENS)[number];

/** Set form for O(1) membership checks against the pinned token set. */
export const TYPED_ERROR_TOKEN_SET: ReadonlySet<TypedErrorToken> = new Set(TYPED_ERROR_TOKENS);

// ─────────────────────────────────────────────────────────────────────────────
// Receipt shape (AD-2 / AC1): `{ v, path, filename, timestamp }`, minted ONCE by
// the Puller and immutable thereafter. `path` is relative to the Target directory
// (never absolute); `timestamp` matches RECEIPT_TIMESTAMP_PATTERN.
// ─────────────────────────────────────────────────────────────────────────────
export const RECEIPT_KEYS = ["v", "path", "filename", "timestamp"] as const;

export interface Receipt {
  /** Contract version at mint time (always FILE_CONTRACT_VERSION). */
  readonly v: typeof FILE_CONTRACT_VERSION;
  /** Destination directory relative to the Target directory (no leading slash). */
  readonly path: string;
  /** Final derived filename (`YYYY-MM-DD-HHmmss-<slug>.<ext>` — derived server-side). */
  readonly filename: string;
  /** Write timestamp, ISO-8601 with a numeric offset. */
  readonly timestamp: string;
}

/**
 * Typed-error envelope (AD-8 / AD-17): a token drawn from the pinned set plus a
 * one-line human-facing message. The token is the machine-readable branch key.
 */
export interface TypedError {
  readonly error: TypedErrorToken;
  readonly message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Published `file` INPUT schema descriptor (FR-1 / AC2 / AC4). The
// machine-readable surface a generic MCP client reads to construct a valid
// request — no Folio runtime, no validation library. `fields` lists every input
// field in canonical order; `validateFileInput` (./index.ts) checks against it.
// ─────────────────────────────────────────────────────────────────────────────
type FieldType = "string";

export interface FieldSpec {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
  /** Regex source (string) for string fields whose value must match a grammar. */
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly description: string;
}

export interface FileInputSchema {
  /** Contract version this schema belongs to. */
  readonly v: typeof FILE_CONTRACT_VERSION;
  readonly tool: "file";
  readonly fields: readonly FieldSpec[];
}

export const FILE_INPUT_SCHEMA: FileInputSchema = {
  v: FILE_CONTRACT_VERSION,
  tool: "file",
  fields: [
    {
      name: "content",
      type: "string",
      required: true,
      minLength: 1,
      description: "The text body to file. Final filename is derived server-side.",
    },
    {
      name: "slug",
      type: "string",
      required: true,
      // Path-safe hint feeding filename derivation: no separators, no traversal.
      pattern: "^[a-z0-9][a-z0-9-]{0,63}$",
      minLength: 1,
      maxLength: 64,
      description: "Target name/slug hint used to derive the filename (lowercase, path-safe).",
    },
    {
      name: "extension",
      type: "string",
      required: true,
      pattern: "^[a-z0-9]{1,16}$",
      minLength: 1,
      maxLength: 16,
      description: "Extension / content-type hint for the derived filename (no leading dot).",
    },
    {
      name: "idempotencyKey",
      type: "string",
      required: true,
      pattern: IDEMPOTENCY_KEY_PATTERN.source,
      minLength: IDEMPOTENCY_KEY_MIN_LENGTH,
      maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
      description:
        "Per-call idempotency key (URL-safe, 16-128 chars). Reuse the SAME key only to retry " +
        "one Filing; a same-key retry reconciles to the original Receipt. See README.md.",
    },
  ],
};

/** Names of every required input field (canonical order). */
export const FILE_INPUT_REQUIRED_FIELDS = FILE_INPUT_SCHEMA.fields
  .filter((f) => f.required)
  .map((f) => f.name);
