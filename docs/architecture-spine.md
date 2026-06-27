---
title: Folio — Architecture Spine (agent-facing distillation)
type: architecture-spine
version: "2026-06-23"
mirrors: _bmad-output/.../ARCHITECTURE-SPINE.md (updated: 2026-06-23)
updated: 2026-06-27
status: current
---

# Folio — Architecture Spine (checked-in, agent-facing)

This is the **checked-in**, legible distillation of Folio's architecture spine. The
long-form design (`_bmad-output/.../ARCHITECTURE-SPINE.md`) is private working
process and is **not committed**; this file is the source of truth every agent
works from. `CLAUDE.md` and the module rules cite its `version` field, and a test
asserts the two agree (so a stale rule set is caught at CI).

When the long-form spine changes, update this file and bump `version` together.
**Spine version: `2026-06-23`.**

## Design paradigm

**Hexagonal (ports & adapters)**, one driven port — `deliver` — split across a
network so the adapter behind it can be swapped without touching the core.

| Layer                                     | Lives in                | Namespace                               |
| ----------------------------------------- | ----------------------- | --------------------------------------- |
| Transport / MCP / OAuth edge / edge guard | Cloudflare Worker       | `relay/src/transport`, `relay/src/auth` |
| Tool handler (core)                       | Cloudflare Worker       | `relay/src/handler`                     |
| Backend port + RelayBackend adapter       | Worker + Durable Object | `relay/src/backend`, `relay/src/broker` |
| Sole writer + write-path safety           | Node container          | `puller/src/*`                          |

Dependency direction is one-way:
`transport → handler → Backend port (deliver) → backend impl`. The handler calls
only `deliver()`; it contains no transport or filesystem calls. The handler MUST
NOT reach the transport or the filesystem. No Claude/KB identifiers in `relay/`
or `puller/`.

## The invariants that bind every story

Each invariant is referenced by its short ID (AD-n). Agents MUST consult these
before touching the seam they govern.

- **AD-1 Layering law.** Handler never touches transport or filesystem. Enforced
  as architectural lint.
- **AD-2 Backend seam contract.** `deliver(payload, idempotencyKey) → Receipt |
TypedError`. Receipt is a pinned, versioned shape
  `{ v, path (relative), filename, timestamp (ISO-8601 +offset) }`, minted once
  by the Puller, immutable after. A stub Backend must register + complete a
  Filing without touching the file schema, auth model, or handler.
- **AD-3 Sole writer.** The Puller is the ONLY filesystem writer. One writable
  mount (the Target directory), non-root, group-writable under umask 002, no
  lock/style file the sync user cannot delete. Relay has zero FS access.
- **AD-4 Receipt gating.** A Receipt is emitted only AFTER durable publish +
  ack. No component synthesises one. Typed errors cross the hop intact.
- **AD-5 Idempotent reconciliation.** Every Filing is anchored by its
  idempotency key in a durable, Puller-owned store. Order: compare-and-set on
  the key → if committed return stored Receipt → else reserve pending (pins the
  final filename) and fsync BEFORE the first temp byte → temp write → integrity
  check → atomic rename → finalize committed → ack. Retry reads the pinned
  filename, never re-derives.
- **AD-6 Path containment (one audited primitive).** ALL path derivation flows
  through one audited containment module: single-decode → Unicode NFC →
  `path.resolve` → `path.relative` containment assertion → `fs.realpath` →
  re-assert at rename with `O_NOFOLLOW`. Rejected inputs → `invalid_path`.
  **No vetted containment library is used — a deliberate, operator-signed-off
  deviation** (see `docs/anti-patterns.md`), NOT a licence to hand-roll elsewhere.
- **AD-7 Atomic publish + integrity gate.** Temp write → verify size + checksum
  → atomic rename. Never overwrite (collision → suffix). Filename
  `YYYY-MM-DD-HHmmss-<slug>.<ext>`, Australia/Sydney tz.
- **AD-8 Typed-error contract.** Canonical tokens: `unauthorized`,
  `puller_offline`, `payload_too_large`, `rate_limited`, `invalid_path`,
  `integrity_failed`, `write_failed`, `idempotency_conflict`. Tokens propagate
  across the hop unchanged.
- **AD-9 Defence-in-depth limits.** Relay edge guard rejects oversize/over-rate
  before forwarding; Puller is the AUTHORITATIVE size + rate enforcer. Size is
  decoded `byteLen`, single-sourced. Edge is never stricter than the Puller.
- **AD-10 Auth model.** OAuth 2.1 + DCR + PKCE S256 via
  `@cloudflare/workers-oauth-provider`; RFC 8707 audience validation (MUST);
  RFC 9728 protected-resource metadata. `file` is gated by ONE
  `isOperator(identity)` predicate owned solely by `relay/auth`, keyed on the
  verified `sub`. Puller↔Relay hop: rotatable static bearer (residual risk,
  mitigated by rotation; mTLS deferred).
- **AD-11 Relay persists nothing at rest.** The DO holds only transient
  in-flight state + the Puller connection. No body content buffered. Puller
  offline → hard-fail `puller_offline`.
- **AD-12 Observability without body content.** Trace
  `action → derived path → outcome` for each Filing, carrying token +
  correlationId + derived path ONLY — never body content or fragments.
- **AD-13 Single state ownership.** Dedupe store → Puller. Connection registry
  - correlation → DO. OAuth tokens → provider storage. `isOperator` →
    `relay/auth` only. Target directory → Puller writes, KB sync reads.
- **AD-14 / AD-18 Correlation + epoch.** DO assigns a unique correlationId per
  forwarded request (never reused; ULID/monotonic). Puller echoes it. Stale-epoch
  acks dropped; on WS drop the DO fails all in-flight callers `puller_offline`.
- **AD-15 / AD-16 Private channel.** Public face is MCP Streamable HTTP. The
  Relay↔Puller hop is a private framed protocol over a persistent outbound WS,
  frozen + versioned in `shared/frame-protocol`. Puller is a WS client (no MCP
  SDK on the home hop).
- **AD-17 Single error-envelope renderer.** One transport function renders every
  error (any origin) into one canonical typed envelope.
- **AD-19 Idempotency-key grammar + hashed handle.** Key validated at BOTH ends;
  store handle is a HASH of the validated key, never the raw key as a path.
  Malformed key → `invalid_path` before any store touch.
- **AD-20 Deployment + rollback.** Relay via Wrangler with versioned rollback.
  Puller image on pinned-digest non-root base, CVE-scanned, Compose-deployed.
  Secrets never baked into images/repo.
- **AD-21 No body-at-rest in any store.** NO Folio store retains payload content
  at rest — not the dedupe store, not traces, not error logs. The written file in
  the Target directory is the SOLE at-rest copy. (Structural guarantee for
  traces: `shared/observability`.)

## Rigour seams (AR-13) — mandatory consult-points

Three seams are security-critical and CANNOT be satisfied from generic priors.
Before changing them, an agent MUST consult the named invariants (declared in
`CLAUDE.md`):

| Seam                | Consult before acting                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| `relay/src/auth`    | AD-10, AD-8, the typed tokens, `docs/primitive-allowlist.md` (OAuth lib) |
| `puller/src/write`  | AD-6, AD-7, AD-3, `docs/anti-patterns.md` (containment deviation)        |
| `puller/src/dedupe` | AD-5, AD-19, AD-21 (no body at rest), AD-13                              |

Coverage on these three seams is threshold-gated at 90% in `vitest.config.ts`.

## Capability → location map

| Concern              | Lives in                                         | Governed by                         |
| -------------------- | ------------------------------------------------ | ----------------------------------- |
| `file` contract      | `relay/handler`, `relay/transport`               | AD-1, AD-2, AD-8, AD-17             |
| Cloud Relay          | `relay/transport`, `relay/broker`                | AD-11, AD-14, AD-16, AD-18          |
| Auth & identity      | `relay/auth`, `puller/channel`                   | AD-10                               |
| Hardened Puller      | `puller/write`, `puller/dedupe`, `puller/limits` | AD-3, AD-5, AD-6, AD-7, AD-9, AD-19 |
| Observability & cost | `relay/*`, `puller/*`, `shared/observability`    | AD-9, AD-12, AD-21                  |
| Backend seam         | `relay/backend`                                  | AD-1, AD-2, AD-10                   |
