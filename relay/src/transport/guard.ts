/**
 * transport stop-gap guard — the interim default-deny control (Story 2.3 AC3).
 *
 * Epic 4 brings the real control: operator-gated OAuth 2.1 in `relay/src/auth`.
 * Until then the `file` endpoint MUST NOT be reachable by an unauthenticated
 * caller — but it must be reachable by a local test client behind a temporary
 * credential so Epic 2 can exercise the transport. This module is that stop-gap:
 * a default-deny allowlist of opaque bearer credentials.
 *
 * DEFAULT-DENY BY CONSTRUCTION: a guard built with an empty allowlist denies
 * EVERYTHING, and a request that presents no credential is denied before it can
 * reach `deliver()` (so an unauthenticated request never triggers a Filing —
 * AC3). The control fails closed: you must explicitly configure a credential to
 * open it at all.
 *
 * STOP-GAP LIFECYCLE: this is interim only. When Epic 4's operator-gated auth
 * lands, this guard MUST be removed or replaced — it must never become the
 * permanent control. The endpoint is never exposed publicly without that auth.
 *
 * The guard is transport-agnostic and dependency-free (no Workers runtime) so
 * the default-deny behaviour is unit-testable under Node.
 */

import type { TypedError } from "../../../shared/file-contract/index.js";

/** A guard outcome: allowed, or denied with the canonical `unauthorized` token. */
export type GuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly error: TypedError };

/** The credential scheme the stop-gap accepts on the `Authorization` header. */
const BEARER_PREFIX = "Bearer ";

/**
 * Extract the presented stop-gap credential from an `Authorization` header
 * value. Returns the bearer token, or `undefined` when the header is absent,
 * malformed, or carries an empty token. A missing credential is the default-deny
 * trigger downstream.
 */
export function extractStopGapCredential(
  authorizationHeader: string | null | undefined,
): string | undefined {
  if (typeof authorizationHeader !== "string") {
    return undefined;
  }
  if (!authorizationHeader.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Parse the configured allowlist from its raw env representation: a string of
 * one or more credentials separated by commas and/or whitespace. An absent or
 * blank value yields an EMPTY allowlist — which denies everything (default-deny).
 */
export function parseAllowlist(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * The stop-gap guard: a default-deny allowlist of opaque credentials. Built from
 * the configured credential set; a request is authorized only when it presents a
 * credential that is a member of that set. An empty set denies everything.
 */
export class StopGapGuard {
  private readonly allow: ReadonlySet<string>;

  constructor(credentials: Iterable<string>) {
    this.allow = new Set([...credentials].filter((c) => c.length > 0));
  }

  /**
   * True iff the guard is configured with at least one credential. A guard that
   * is NOT armed denies every request — the endpoint cannot be reached at all
   * until a credential is explicitly configured (fail-closed).
   */
  get isArmed(): boolean {
    return this.allow.size > 0;
  }

  /**
   * Decide one request. Denies (`unauthorized`) when no credential is presented
   * or the presented credential is not on the allowlist; allows only an exact
   * allowlist match. This is the gate that stands before `deliver()`.
   */
  authorize(presented: string | null | undefined): GuardDecision {
    if (typeof presented !== "string" || presented.length === 0) {
      return deny("no stop-gap credential presented");
    }
    if (!this.allow.has(presented)) {
      return deny("stop-gap credential not recognised");
    }
    return { allowed: true };
  }
}

/** Build the canonical `unauthorized` denial (AD-8 typed token). */
function deny(message: string): GuardDecision {
  return { allowed: false, error: { error: "unauthorized", message } };
}
