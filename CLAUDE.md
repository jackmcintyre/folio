# CLAUDE.md — Folio

Short, current context for any agent working in this repo. The long-form design
is private (`_bmad-output/`, not committed); **`docs/architecture-spine.md` is
the checked-in spine** every rule below cites. A test asserts every citation
matches that spine's version — stale rules fail CI.

- **Spine version cited by every rule:** `2026-06-23` (see `docs/architecture-spine.md`).
- **What Folio is:** a write-only file tool (`file`) for Claude, delivered through
  a Cloudflare Worker (`relay/`) that brokers to a Node sole-writer (`puller/`)
  over a private WebSocket. Hexagonal core; one driven port `deliver`.
- **Start here:** `README.md`, `docs/architecture-spine.md`, `docs/standards.md`.
- **Workflow:** never commit to `main`; each unit of work in its own worktree
  branch (`story/bmad-<epic>-<story>-<slug>`). See `docs/contributing.md`.

## Top-level rules (≤10)

Each rule cites the spine version it was checked against.

1. One-way layering: `transport → handler → deliver() → backend`. The handler
   calls only `deliver()`; it has no transport or filesystem calls. <!-- spine=2026-06-23 -->
2. The Puller is the ONLY filesystem writer; the Relay has zero FS access. One
   writable mount, non-root, group-writable (umask 002). <!-- spine=2026-06-23 -->
3. No Folio store retains body content at rest — not the dedupe store, not
   traces, not error logs. The written file is the sole at-rest copy. <!-- spine=2026-06-23 -->
4. Failures use the canonical typed tokens (`unauthorized`, `puller_offline`,
   `payload_too_large`, `rate_limited`, `invalid_path`, `integrity_failed`,
   `write_failed`, `idempotency_conflict`); they cross the hop unchanged. <!-- spine=2026-06-23 -->
5. A Receipt is minted by the Puller only after durable publish + ack; nothing
   synthesises one. Shape `{ v, path (relative), filename, timestamp }`, immutable. <!-- spine=2026-06-23 -->
6. Every Filing is anchored by its idempotency key (durable, Puller-owned);
   reserve-before-write, reconcile same-key retries to one Receipt. <!-- spine=2026-06-23 -->
7. All path derivation flows through ONE audited containment primitive (AD-6).
   No vetted library is used for it (signed-off deviation) — and that exception
   does NOT authorise hand-rolling any other primitive. <!-- spine=2026-06-23 -->
8. Use the vetted library named in `docs/primitive-allowlist.md` for OAuth/auth,
   ID generation, rate-limiting, and time/timezone. Do not hand-roll them. <!-- spine=2026-06-23 -->
9. Trace only `action → derived path → outcome` per Filing (token +
   correlationId + derived path). Construct traces via `shared/observability`,
   which has no field for body by construction. <!-- spine=2026-06-23 -->
10. Keep `docs/standards.md` ≤ 10 named MUST rules (CI-enforced cap) so the
    rulebook an agent must obey stays legible. <!-- spine=2026-06-23 -->

## Module rules

### relay/ (Cloudflare Worker: transport, auth, handler, backend, broker)

- Edge guard rejects oversize/over-rate before forwarding; the Puller is the
  authoritative size + rate enforcer. Edge is never stricter than the Puller.
- The DO holds only transient in-flight state + the Puller connection — it
  persists no body content. Puller offline → hard-fail `puller_offline`.
- One error-envelope renderer for every error, regardless of origin.
- Public face is MCP Streamable HTTP; the Relay↔Puller hop is the private framed
  protocol in `shared/frame-protocol` (Puller has no MCP SDK on that hop).

### puller/ (Node 24 sole writer: channel, write, dedupe, limits)

- Filename `YYYY-MM-DD-HHmmss-<slug>.<ext>`, Australia/Sydney tz.
- Temp write → verify size + checksum → atomic rename. Never overwrite.
- Size measured as decoded `byteLen` at both layers, single-sourced.
- Correlation ids are never reused (ULID/monotonic); stale-epoch acks dropped.

## Mandatory consult-points (AR-13)

These seams are security-critical and CANNOT be satisfied from generic LLM
priors. Before changing them, consult the named sources:

- **`relay/src/auth`** — consult AD-10 (OAuth 2.1 + DCR + PKCE S256, RFC 8707
  audience validation, the single `isOperator(identity)` predicate on the
  verified `sub`), AD-8 tokens, and `docs/primitive-allowlist.md` (OAuth lib).
- **`puller/src/write`** — consult AD-6 (the one containment primitive + the
  signed-off no-library deviation), AD-7 (atomic publish + integrity gate),
  AD-3 (sole writer), and `docs/anti-patterns.md`.
- **`puller/src/dedupe`** — consult AD-5 (reserve-before-write CAS protocol),
  AD-19 (key grammar + hashed handle), AD-21 (no body at rest), AD-13 (ownership).

Coverage on these three seams is threshold-gated at 90% in `vitest.config.ts`.

## Living guardrail docs

- `docs/architecture-spine.md` — the checked-in spine (cited above).
- `docs/standards.md` — the bounded rulebook (≤10 MUST rules).
- `docs/anti-patterns.md` — logged deviations, seeded with the AD-6 containment
  no-library decision.
- `docs/primitive-allowlist.md` — vetted library per primitive; hand-rolling
  forbidden (path handling the documented exception).
- `docs/risk-tiers.yaml` — human-gated vs auto-mergeable paths.
