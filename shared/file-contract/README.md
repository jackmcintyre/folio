# The `file` tool contract

This is the **pinned, versioned public surface** of Folio's single MCP tool,
`file` (FR-1, FR-3). It is deliberately generic — no Claude-isms, no KB-isms
(SM-4): any MCP-capable client can call `file` using only what is published here.
The schema, the Receipt shape, the typed-error token set, and the idempotency-key
grammar are all part of one versioned contract. An incompatible change **must**
bump the version and is caught by the contract test in CI (Story 1.5 AC3).

The canonical source of truth is [`index.ts`](./index.ts). This doc is the
human-readable contract; where they appear to disagree, the code wins.

## Version

**Contract version: `1`** (`FILE_CONTRACT_VERSION` in `index.ts`). The contract
carries an explicit version identifier so clients and tests can pin to it
(FR-3). Every Receipt also carries `v` so a client can confirm which contract
version produced it. Bump the version on any incompatible change to the shapes
below.

## Input schema

`file` accepts an object with these fields (FR-1: content body + slug hint +
extension hint; FR-13/AD-19: a required idempotency key):

| Field            | Type   | Required | Grammar                             | Meaning                                                 |
| ---------------- | ------ | -------- | ----------------------------------- | ------------------------------------------------------- |
| `content`        | string | yes      | non-empty                           | The text body to file. Filename derived server-side.    |
| `slug`           | string | yes      | `^[a-z0-9][a-z0-9-]{0,63}$`         | Target name/slug hint for the derived filename.         |
| `extension`      | string | yes      | `^[a-z0-9]{1,16}$` (no leading dot) | Extension / content-type hint for the derived filename. |
| `idempotencyKey` | string | yes      | `^[A-Za-z0-9_-]{16,128}$`           | Per-call idempotency key — see below.                   |

The server derives the final filename (`YYYY-MM-DD-HHmmss-<slug>.<ext>`,
Australia/Sydney tz); the client supplies only the hints, never the final name
(FR-12).

A request **missing the idempotency key is invalid** against this schema and is
rejected (AC2; the contract test asserts this). There is no content-derived
fallback (FR-13).

### How a client generates an idempotency key (per call)

The idempotency key is **caller-supplied and required**. A client — including the
Claude connector — generates **one fresh key per Filing call** using any of:

- a **ULID** (26 chars, Crockford base32),
- a **UUIDv7** (string form, 36 chars), or
- **32 random bytes** base64url-encoded (43 chars, no padding).

All three satisfy the grammar `^[A-Za-z0-9_-]{16,128}$` (URL-safe, 16-128 chars,
no path separators). The key MUST be generated with a fresh, unpredictable
random source per call — never a counter, never a hard-coded constant.

**Retry semantics:** reuse the **same** key only to retry a single Filing whose
outcome is unknown (e.g. a lost ack). A same-key retry reconciles to the
original Receipt rather than writing a second file (FR-13). A same-key retry
whose **content differs** from the original is a conflict and returns
`idempotency_conflict` — never a Receipt, never an overwrite. Reusing a key
across two logically distinct Filings is a client bug.

The key is validated at both ends and is never used raw as a store path: the
durable store handle is a hash of the validated key (AD-19).

## Receipt (success result)

On success `file` returns a Receipt — shape `{ v, path, filename, timestamp }`,
minted **once** by the Puller and immutable thereafter (AD-2, FR-2). No other
component constructs a Receipt.

```jsonc
{
  "v": "1",
  "path": "notes/2026/06", // relative to the Target directory (no leading slash)
  "filename": "2026-06-27T14-30-00-summary.md",
  "timestamp": "2026-06-27T14:30:00+10:00", // ISO-8601 WITH a numeric offset
}
```

- `path` is relative to the operator's Target directory (never an absolute path).
- `timestamp` is ISO-8601 with a **numeric** offset (`[+-]HH:MM`), e.g.
  `+10:00`. The Receipt is minted in Australia/Sydney time, so it always carries
  a real local offset — never a bare `Z`.
- The Receipt is returned **only after** the Puller has durably published and
  acknowledged the write (FR-2 / FR-9). No component synthesises a Receipt.

## Typed errors (failure result)

On failure `file` returns a typed error — a token drawn from the canonical,
pinned set of **eight** (AD-8), plus a one-line human-facing message:

```jsonc
{ "error": "puller_offline", "message": "the puller is not connected" }
```

The token is the machine-readable branch key; clients and tests branch on the
token, never on the prose. Tokens propagate across the Relay hop unchanged.

| Token                  | Meaning                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `unauthorized`         | Caller is not authenticated / not an operator.                   |
| `puller_offline`       | The puller is not connected; the write could not be attempted.   |
| `payload_too_large`    | The payload exceeds the size limit.                              |
| `rate_limited`         | The caller exceeded the rate limit.                              |
| `invalid_path`         | The derived path, slug, or idempotency key is malformed.         |
| `integrity_failed`     | The write failed its integrity check.                            |
| `write_failed`         | The filesystem write failed.                                     |
| `idempotency_conflict` | A same-key retry whose content differs from the original Filing. |

(`idempotency_conflict` extends the PRD §3 set by one — operator-confirmed
2026-06-23.)

## Consuming the contract

Both Folio workspaces (`relay/`, `puller/`) import from here; the contract test
asserts the frozen shape from the perspective of a generic client using only the
published schema (Story 1.5 AC4). Because the schema is published as a
serialisable descriptor plus a dependency-free validator, a generic client can
construct and check a request, and parse a Receipt or any typed error, without
any Claude- or KB-specific knowledge.

## Contract test (AC3)

The frozen shapes above are pinned by
[`tests/file-contract.test.ts`](../../tests/file-contract.test.ts) — the contract
test that fails CI on any incompatible change (Story 1.5 AC3). Run it with:

```sh
npm test
```

From the perspective of a generic client using only the published schema, it
asserts: the explicit version field; the Receipt key set
`{ v, path, filename, timestamp }` (rejecting unknown keys, absolute paths, and
bare-`Z` timestamps); the canonical eight typed-error tokens as an exact set; the
required idempotency-key grammar, including that a call missing the key is
invalid; and that a generic client can construct a valid request and parse every
Receipt and typed error (AC4). Rename a Receipt key, drop a token, or reshape the
schema in `index.ts` and the suite fails — the surface cannot silently regress.
