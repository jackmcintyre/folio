/**
 * puller/src/limits
 *
 * Authoritative size and rate enforcement (AD-9).
 *
 * The Puller is the authoritative enforcer; the Relay applies a looser first-line
 * edge guard only (edge >= Puller permissiveness — AD-9).
 *
 * Size: 1 MiB decoded body cap (§10.6), measured as decoded byteLen.
 * Rate: 10 requests/minute sliding window keyed by operator identity (§10.6).
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

export const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB decoded
export const RATE_LIMIT_PER_MINUTE = 10;
