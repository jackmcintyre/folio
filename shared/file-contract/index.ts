/**
 * file-contract — the pinned, versioned `file` tool contract (FR-1, FR-3, AD-2, AD-8, AD-19).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the public `file` tool surface:
 * the input schema, the Receipt shape, the typed-error token set, and the
 * idempotency-key grammar. It is deliberately GENERIC — no Claude-isms, no
 * KB-isms (SM-4): any MCP-capable client can call `file` using only what is
 * published here.
 *
 * The contract is dependency-free and self-contained: the schema is published as
 * a serialisable descriptor (`FILE_INPUT_SCHEMA`) plus a validator
 * (`validateFileInput`), so a generic client can construct and check a request
 * without importing a validation library or any Folio runtime. The Receipt and
 * typed-error shapes have matching parsers (`parseReceipt`, `parseTypedError`).
 *
 * Frozen surface — every export here is part of the versioned contract. An
 * incompatible change MUST bump `FILE_CONTRACT_VERSION` and is caught by the
 * contract test in CI (FR-3 / Story 1.5 AC3). See README.md for the contract
 * doc, including how a client generates an idempotency key per call.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Version (FR-3 / AC1): the contract carries an explicit version identifier so
// clients and tests can pin to it. Bumped on any incompatible change to the
// shapes below. Pin format: a single integer, stringified (mirrors the
// frame-protocol version convention).
// ─────────────────────────────────────────────────────────────────────────────
export const FILE_CONTRACT_VERSION = "1" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency-key grammar (AD-19 / AC2).
//
// Pinned and validated at BOTH ends (relay on ingest, puller before any store
// touch). A malformed key is rejected with `invalid_path` before the durable
// store is touched. The durable-store handle is a HASH of the validated key,
// never the raw key as a path.
//
// The grammar prevents:
//   - traversal / path injection — no `/`, `\`, `.`, or NUL (the charset is
//     URL-safe `[A-Za-z0-9_-]` only);
//   - case-collision dedupe — upper- and lower-case are BOTH allowed and are
//     distinct keys (the hash input is the raw, case-sensitive key, so two
//     keys differing only in case hash to distinct handles);
//   - weak / trivial keys — a 16-char minimum;
//   - unbounded keys — a 128-char maximum.
// ─────────────────────────────────────────────────────────────────────────────
export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Receipt timestamp grammar (AC1): ISO-8601 WITH a numeric UTC offset
// (`[+-]HH:MM`), e.g. `2026-06-27T14:30:00+10:00`. The Receipt is Puller-minted
// and the Puller runs in Australia/Sydney time, so it always carries a real
// local offset — never a bare `Z`. Fractional seconds are permitted.
// ─────────────────────────────────────────────────────────────────────────────
export const RECEIPT_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Typed-error token set (AD-8 / AC1): the canonical EIGHT tokens. This is part
// of the versioned contract; tokens propagate across the Relay hop unchanged.
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
// the Puller and immutable thereafter. No layer reshapes it. `path` is relative
// to the Target directory (never an absolute filesystem path); `timestamp` is
// ISO-8601 with offset (matches RECEIPT_TIMESTAMP_PATTERN).
// ─────────────────────────────────────────────────────────────────────────────
export const RECEIPT_KEYS = ["v", "path", "filename", "timestamp"] as const;
export type ReceiptKey = (typeof RECEIPT_KEYS)[number];

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

// ─────────────────────────────────────────────────────────────────────────────
// Typed-error envelope (AD-8 / AD-17): a token drawn from the pinned set plus a
// one-line human-facing message. The token is the machine-readable branch key.
// ─────────────────────────────────────────────────────────────────────────────
export interface TypedError {
  readonly error: TypedErrorToken;
  readonly message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Published `file` INPUT schema descriptor (FR-1 / AC2 / AC4).
//
// This is the machine-readable surface a generic MCP client reads to construct a
// valid request — no Folio runtime, no validation library. `fields` lists every
// input field in canonical order; `validateFileInput` checks a value against it.
// Per FR-1 the tool accepts "content body, a target name/slug hint, and an
// extension/content-type hint"; the contract adds the REQUIRED idempotency key
// (FR-13 / AD-19 — a call without one is rejected).
// ─────────────────────────────────────────────────────────────────────────────
export type FieldType = "string";

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

/** Result of validating an unknown value against the input schema. */
export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: string[] };

/**
 * Validate an unknown value against the published `file` input schema. Pure,
 * dependency-free. Returns `{ ok: true }` or `{ ok: false, errors }` listing
 * every violation. A request MISSING the idempotency key fails here (AC2).
 */
export function validateFileInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["file input must be an object"] };
  }

  const obj = input as Record<string, unknown>;

  for (const spec of FILE_INPUT_SCHEMA.fields) {
    const present = spec.name in obj;
    const value = obj[spec.name];

    if (spec.required && (present === false || value === undefined || value === null)) {
      errors.push(`missing required field: ${spec.name}`);
      continue;
    }
    if (present === false) {
      // Optional field, absent: fine.
      continue;
    }

    if (typeof value !== "string") {
      errors.push(`field ${spec.name} must be a string`);
      continue;
    }

    if (spec.minLength !== undefined && value.length < spec.minLength) {
      errors.push(`field ${spec.name} length ${value.length} below minimum ${spec.minLength}`);
    }
    if (spec.maxLength !== undefined && value.length > spec.maxLength) {
      errors.push(`field ${spec.name} length ${value.length} above maximum ${spec.maxLength}`);
    }
    if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) {
      errors.push(`field ${spec.name} does not match grammar ${spec.pattern}`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Parse an unknown value as a Receipt (AC4). Asserts the EXACT pinned key set
 * `{ v, path, filename, timestamp }`, the version, and the timestamp grammar.
 * Rejects unknown keys (a shape change) so an incompatible Receipt fails loudly.
 */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: string[] };

export function parseReceipt(value: unknown): ParseResult<Receipt> {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["receipt must be an object"] };
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const expected = [...RECEIPT_KEYS].sort();

  if (keys.length !== expected.length || !keys.every((k, i) => k === expected[i])) {
    return {
      ok: false,
      errors: [
        `receipt keys must be exactly {${RECEIPT_KEYS.join(", ")}}, got {${keys.join(", ")}}`,
      ],
    };
  }

  if (obj["v"] !== FILE_CONTRACT_VERSION) {
    errors.push(`receipt.v must be "${FILE_CONTRACT_VERSION}", got ${JSON.stringify(obj["v"])}`);
  }
  if (typeof obj["path"] !== "string" || obj["path"].length === 0) {
    errors.push("receipt.path must be a non-empty string (relative to the Target directory)");
  } else if (obj["path"].startsWith("/")) {
    errors.push("receipt.path must be relative to the Target directory (no leading slash)");
  }
  if (typeof obj["filename"] !== "string" || obj["filename"].length === 0) {
    errors.push("receipt.filename must be a non-empty string");
  }
  if (typeof obj["timestamp"] !== "string" || !RECEIPT_TIMESTAMP_PATTERN.test(obj["timestamp"])) {
    errors.push(
      `receipt.timestamp must be ISO-8601 with a numeric offset (e.g. 2026-06-27T14:30:00+10:00), got ${JSON.stringify(obj["timestamp"])}`,
    );
  }

  return errors.length === 0
    ? { ok: true, value: obj as unknown as Receipt }
    : { ok: false, errors };
}

/**
 * Parse an unknown value as a TypedError (AC4): `{ error: <token>, message }`
 * where the token is one of the canonical EIGHT. An unknown token fails here.
 */
export function parseTypedError(value: unknown): ParseResult<TypedError> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["typed error must be an object"] };
  }
  const obj = value as Record<string, unknown>;
  const token = obj["error"];
  if (typeof token !== "string" || !TYPED_ERROR_TOKEN_SET.has(token as TypedErrorToken)) {
    return {
      ok: false,
      errors: [
        `typed error.error must be one of {${TYPED_ERROR_TOKENS.join(", ")}}, got ${JSON.stringify(token)}`,
      ],
    };
  }
  if (typeof obj["message"] !== "string" || obj["message"].length === 0) {
    return { ok: false, errors: ["typed error.message must be a non-empty string"] };
  }
  return { ok: true, value: obj as unknown as TypedError };
}
