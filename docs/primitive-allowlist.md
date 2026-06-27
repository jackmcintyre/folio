---
title: Folio — Primitive allow-list
type: primitive-allowlist
version: "0.1.0"
updated: "2026-06-27"
status: living
---

# Folio — Primitive allow-list

For each "solved primitive" below, use the **one** named vetted library. Do NOT
hand-roll it. This is a pre-flight fold: an agent that reaches for a hand-rolled
implementation of one of these must stop and use the named library instead, or
record a deviation in `docs/anti-patterns.md` first.

Hand-rolling a security/time-correctness primitive silently is the anti-pattern
this list exists to prevent. If a named library is genuinely unsuitable, the
correct response is a signed-off `docs/anti-patterns.md` entry, not a quiet
hand-roll.

| Primitive                       | Use this library                                             | Why (don't hand-roll)                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth / auth                    | `@cloudflare/workers-oauth-provider` (`0.8.x`, exact-pinned) | OAuth 2.1 + DCR + PKCE S256, RFC 8707 audience validation. Auth protocol code is exactly the kind of seam generic priors get subtly, fatally wrong. (AD-10)                                                                       |
| ID generation (correlation ids) | `ulid`                                                       | AD-18 requires correlation ids that are never reused and sort by time. ULID gives lexicographically-sortable, collision-resistant ids without a central counter. Hand-rolling monotonicity across reconnects is the failure mode. |
| Rate-limiting                   | `rate-limiter-flexible`                                      | AD-9 sliding window keyed by operator identity, with the edge never stricter than the Puller. A vetted limiter handles the sliding-window arithmetic and race edge cases; hand-rolled counters leak under concurrency.            |
| Time / timezone                 | `luxon`                                                      | AD-7 derives filenames in `Australia/Sydney` (DST-correct). Luxon bundles its zone data so derivation is correct regardless of the runtime ICU build; hand-rolled `Date` offset math is the classic DST bug.                      |

## Documented exception — path handling

Path containment deliberately uses **no vetted library** (AD-6). This is the sole
recorded exception, operator-signed-off 2026-06-23, scoped to `puller/src/write`
only. The reason and mitigation live in `docs/anti-patterns.md` (AP-1): no
vetted library covers the full AD-6 pipeline (decode + NFC normalise + resolve +
relative-containment + `fs.realpath` + `O_NOFOLLOW` re-check), so the work is
centralised into one audited primitive with a traversal test battery.

**This exception authorises hand-rolling path containment in that one module and
nothing else.** It is not a precedent for any other primitive in this list.

## Adding or changing an entry

- New primitive → add a row naming exactly one vetted library + the "don't
  hand-roll" reason.
- Library superseded → update the row; do not delete the old choice without a
  one-line note on why the replacement is trusted.
- Genuine deviation → record it in `docs/anti-patterns.md` first, then link it
  here as an exception (as path handling is above).
