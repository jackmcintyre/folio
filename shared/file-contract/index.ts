/**
 * file-contract — validators + parsers for the pinned, versioned `file` tool
 * contract (FR-1, FR-3, AD-2, AD-8, AD-19).
 *
 * Together with ./types.ts (the frozen shapes + schema descriptor, re-exported
 * below) this module is the SINGLE SOURCE OF TRUTH for the public `file` tool
 * surface. It is deliberately GENERIC — no Claude-isms, no KB-isms (SM-4): any
 * MCP-capable client can call `file` using only what is published here. The
 * contract is dependency-free: a serialisable schema descriptor
 * (`FILE_INPUT_SCHEMA`) plus pure validators/parsers (`validateFileInput`,
 * `parseReceipt`, `parseTypedError`), so a generic client can construct and
 * check a request without importing a validation library or any Folio runtime.
 *
 * Frozen surface — every export is part of the versioned contract. An
 * incompatible change MUST bump `FILE_CONTRACT_VERSION` and is caught by the
 * contract test in CI (FR-3 / Story 1.5 AC3). See README.md for the contract doc.
 */

export * from "./types.js";
import {
  FILE_CONTRACT_VERSION,
  FILE_INPUT_SCHEMA,
  type FieldSpec,
  type Receipt,
  RECEIPT_KEYS,
  RECEIPT_TIMESTAMP_PATTERN,
  type TypedError,
  type TypedErrorToken,
  TYPED_ERROR_TOKENS,
  TYPED_ERROR_TOKEN_SET,
} from "./types.js";

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
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["file input must be an object"] };
  }
  const obj = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const spec of FILE_INPUT_SCHEMA.fields) {
    errors.push(...validateField(spec, spec.name in obj, obj[spec.name]));
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Validate one field value against its spec; returns the violations (possibly
 *  empty). An absent optional field is fine; an absent required field, a
 *  non-string, or a grammar/length miss each yields one message. */
function validateField(spec: FieldSpec, present: boolean, value: unknown): string[] {
  const missing = present === false || value === undefined || value === null;
  if (spec.required && missing) return [`missing required field: ${spec.name}`];
  if (missing) return []; // optional field, absent
  if (typeof value !== "string") return [`field ${spec.name} must be a string`];
  return stringFieldErrors(spec, value);
}

/** Length + grammar checks for a string field whose presence/type are settled. */
function stringFieldErrors(spec: FieldSpec, value: string): string[] {
  const errors: string[] = [];
  if (spec.minLength !== undefined && value.length < spec.minLength) {
    errors.push(`field ${spec.name} length ${value.length} below minimum ${spec.minLength}`);
  }
  if (spec.maxLength !== undefined && value.length > spec.maxLength) {
    errors.push(`field ${spec.name} length ${value.length} above maximum ${spec.maxLength}`);
  }
  if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) {
    errors.push(`field ${spec.name} does not match grammar ${spec.pattern}`);
  }
  return errors;
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
  const errors = receiptFieldErrors(obj);
  return errors.length === 0
    ? { ok: true, value: obj as unknown as Receipt }
    : { ok: false, errors };
}

/** Field-level checks for a Receipt whose key set is already known-exact:
 *  version pin, relative non-empty path, non-empty filename, offset timestamp. */
function receiptFieldErrors(obj: Record<string, unknown>): string[] {
  const errors: string[] = [];
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
  return errors;
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
