/**
 * relay/src/auth
 *
 * OAuth 2.1 + DCR + PKCE S256 configuration via @cloudflare/workers-oauth-provider.
 * Owns the `isOperator(identity)` predicate — the only component that may decide
 * whether a registered identity is permitted to call the `file` tool (AD-10).
 *
 * RFC 8707 token-audience validation (MUST) and RFC 9728 protected-resource
 * metadata are configured here.
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

/** Opaque identity type returned by the OAuth provider after verification. */
export interface VerifiedIdentity {
  sub: string;
}

/**
 * Returns true when the verified identity is authorised to invoke the `file` tool.
 * The gate is keyed on the pinned immutable `sub` claim (AD-10).
 *
 * Stub — always false until the operator wires in the real predicate.
 */
export function isOperator(_identity: VerifiedIdentity): boolean {
  return false;
}
