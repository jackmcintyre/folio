# Folio — CLAUDE.md

Short, current rules for agents working in this repo.  Read the Architecture Spine in
`_bmad-output/planning-artifacts/architecture/` for invariants; this file covers
day-to-day coding constraints only.

## Module rules

### relay/ (Cloudflare Worker)

- **Layering law (AD-1):** dependency direction is strictly one-way —
  `transport → handler → Backend port (deliver) → backend impl`.
  The handler calls only `deliver()`; it contains **no** transport or filesystem calls.
- **No Claude/KB identifiers** in `relay/` or `puller/` source.
- Workers entry-point is `relay/src/transport/index.ts` (wrangler.toml `main`).
- Runtime is pinned to `compatibility_date = "2026-06-23"` and `compatibility_flags = ["nodejs_compat"]` — **do not change without a deliberate version bump and rationale comment.**
- TypeScript strict mode — all strict flags on, no `any` without an explicit `// eslint-disable` comment and justification.

### puller/ (Node container)

- **Sole writer (AD-3):** the Puller is the only component that writes the filesystem.
  No other module may import from `puller/src/write/` or call its functions.
- Node 24 LTS is the pinned runtime (`engines.node: ^24` in `puller/package.json`).
- **`ws` exact-pinned at `8.21.0`** — do not range-bump without a security review.
- All path operations must go through the single audited containment module in
  `puller/src/write/` (AD-6) — never hand-roll a path join inline.

### shared/frame-protocol/

- **Versioned contract (AD-16):** increment `FRAME_PROTOCOL_VERSION` when the frame
  shape changes; never break backwards compatibility within a version.
- Conformance vectors in `shared/frame-protocol/index.ts` must be kept in sync with
  any schema change and asserted on **both** relay and puller sides in CI.

## Load-bearing dep pins (AR-1)

These must remain **exact-pinned** (no `^` or `~` prefix).  Bump only deliberately
with a rationale comment:

| Package | Pin | Reason |
|---|---|---|
| `agents` | `0.16.x` | pre-1.0, load-bearing McpAgent / DO API |
| `@cloudflare/workers-oauth-provider` | `0.8.x` | pre-1.0, auth contract |
| `ws` | `8.21.0` | home-hop WS client |
| `typescript` | `5.x` | lockfile-pinned in both workspaces |

`@modelcontextprotocol/sdk` stays on `^1.29` (v1-stable, patch-track).

## Errors

All named failure modes throw a `DomainError` subclass with a one-line user-facing
message (AD-8 / `docs/standards.md`).  `throw new Error(...)` for known failures is a
standards violation.

## No secrets in code

Secrets go in env / Cloudflare secret store only (AD-20).  Never in source, comments,
test fixtures, or the repo.
