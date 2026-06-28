/**
 * backoff — bounded exponential-backoff calculator for the outbound channel's
 * auto-reconnect (Story 2.1 AC3 / AR-18 / NFR-3).
 *
 * Pure and stateless: it computes the delay for a given attempt index, capped at
 * a maximum. The connection layer owns the attempt counter and the timers; this
 * module owns only the curve, so the bound is provable and mutation-testable in
 * isolation — the place a wrong bound would hide is the curve itself.
 *
 *   delay(attempt) = min( minMs * 2^attempt , maxMs )
 *
 * The curve is monotonically increasing until it hits the cap, then flat: the
 * reconnect interval backs off on repeated failures but never grows without
 * bound (NFR-3). `attempt` is 0-based, so the first reconnect after a drop uses
 * `minMs`. Inputs are clamped so a misconfigured caller cannot manufacture an
 * unbounded or negative delay through this seam.
 */

/** Clamp attempt to a non-negative integer. */
function clampAttempt(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) return 0;
  return Math.floor(attempt);
}

/**
 * Bounded exponential-backoff delay in milliseconds.
 *
 * @param attempt 0-based reconnect attempt index (0 = first reconnect).
 * @param minMs   floor delay (also the first reconnect delay).
 * @param maxMs   ceiling delay; the curve flattens at this value.
 * @returns the reconnect delay; always finite and in [minMs, maxMs].
 */
export function backoffDelay(attempt: number, minMs: number, maxMs: number): number {
  const a = clampAttempt(attempt);
  const min = Number.isFinite(minMs) && minMs > 0 ? minMs : 0;
  // The ceiling is never below the floor — a misconfigured max cannot force a
  // delay below min, and a non-finite ceiling flattens the curve at min.
  const max = Number.isFinite(maxMs) && maxMs >= min ? maxMs : min;
  const raw = min * 2 ** a;
  // 2**a overflows to Infinity past ~attempt 1024; min(.,max) collapses that.
  return Math.min(raw, max);
}
