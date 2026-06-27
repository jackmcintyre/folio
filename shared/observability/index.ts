/**
 * observability — the tracing primitive (FR-15, AD-12, AD-21).
 *
 * A TraceRecord carries action + correlationId + derivedPath + outcome ONLY.
 * Body content and content fragments are absent BY CONSTRUCTION: the type has
 * no field for them, and the constructor sanitises every field so body-like
 * content cannot be smuggled through (for example as a multi-line "path"). No
 * Folio store retains payload content at rest (AD-21); this module is the
 * structural guarantee for traces.
 *
 * Both relay/ and puller/ import from here; the record shape is the wire format
 * for a single Filing's observability line.
 */

/** Outcome tokens — success plus the canonical typed-error set (AD-8). */
export const OUTCOME_TOKENS = [
  "success",
  "unauthorized",
  "puller_offline",
  "payload_too_large",
  "rate_limited",
  "invalid_path",
  "integrity_failed",
  "write_failed",
  "idempotency_conflict",
] as const;

export type OutcomeToken = (typeof OUTCOME_TOKENS)[number];

/**
 * The ONLY shape a trace may take. There is deliberately NO field for body,
 * content, payload, or any fragment thereof (AD-21). Adding one is a rule
 * break, not an extension.
 */
export interface TraceRecord {
  readonly action: string;
  readonly correlationId: string;
  readonly derivedPath: string;
  readonly outcome: OutcomeToken;
}

/**
 * Trace input. Same shape as the record — body cannot be passed. TypeScript
 * excess-property checks reject a `trace({ ...body })` literal at compile time;
 * at runtime the constructor drops any stray key and validates the four it
 * keeps, so a structurally-typed caller cannot retain body either.
 */
export interface TraceInput {
  readonly action: string;
  readonly correlationId: string;
  readonly derivedPath: string;
  readonly outcome: OutcomeToken;
}

/** Field length bounds — a trace line is short; body content is not. */
const MAX_ACTION_LEN = 64;
const MAX_CORRELATION_LEN = 64;
const MAX_PATH_LEN = 512;

/** Action + correlationId grammar: short identifier-ish tokens only. */
const IDENT_RE = /^[A-Za-z0-9._:-]+$/;

/**
 * True if the value contains any byte that lets body content pose as a path:
 * every C0 control byte (newline, carriage return, tab, NUL, ...) plus DEL.
 * Written as a code-point scan so no regex character class can be mangled by
 * escape handling.
 */
function containsControlByte(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Thrown when a trace field would carry disallowed content. A trace field
 * rejection is a programming error (the caller tried to trace something that is
 * not a trace), not a user-facing failure — it must surface loudly.
 */
export class TraceFieldError extends Error {
  constructor(
    public readonly field: keyof TraceRecord,
    public readonly reason: string,
  ) {
    super(`trace field '${field}' rejected: ${reason}`);
    this.name = "TraceFieldError";
  }
}

function isOutcomeToken(value: unknown): value is OutcomeToken {
  return typeof value === "string" && (OUTCOME_TOKENS as readonly string[]).includes(value);
}

function assertIdent(field: keyof TraceRecord, value: string, maxLen: number): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLen ||
    !IDENT_RE.test(value)
  ) {
    throw new TraceFieldError(
      field,
      `must be a 1..${maxLen}-char identifier matching ${IDENT_RE.source}`,
    );
  }
}

function assertDerivedPath(field: keyof TraceRecord, value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LEN ||
    containsControlByte(value)
  ) {
    throw new TraceFieldError(
      field,
      `must be a 1..${MAX_PATH_LEN}-char relative path with no control or newline chars`,
    );
  }
}

/**
 * Mint a trace record. Every field is validated so body content or fragments
 * cannot enter the record. Returns a frozen record with EXACTLY the four
 * permitted keys — serialise it, store it, log it; nothing else can be there.
 *
 * @throws {TraceFieldError} if any field is missing, too long, or carries
 *   body-like content.
 */
export function trace(input: TraceInput): TraceRecord {
  assertIdent("action", input.action, MAX_ACTION_LEN);
  assertIdent("correlationId", input.correlationId, MAX_CORRELATION_LEN);
  assertDerivedPath("derivedPath", input.derivedPath);
  if (!isOutcomeToken(input.outcome)) {
    throw new TraceFieldError("outcome", "must be one of OUTCOME_TOKENS");
  }

  // Construct with EXACTLY the four permitted keys — any stray key on the input
  // (e.g. a caller's `body`) is dropped here, never retained.
  return Object.freeze({
    action: input.action,
    correlationId: input.correlationId,
    derivedPath: input.derivedPath,
    outcome: input.outcome,
  });
}
