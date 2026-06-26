# Contributing to Folio

This document defines the **worktree + branch workflow** every unit of work
follows, the **per-worktree dev-environment isolation** that keeps concurrent
runs from colliding, and the **`main` is physically uncommittable** guarantee
that underpins both.

It realises Story 1.2 (AC1, AC2, AC3) and the architecture's Consistency
Convention: _"`main` physically uncommittable; each unit of work in its own
worktree."_

---

## 1. One worktree + branch per unit of work

Every unit of work — a story, a spike, a fix — lives in its **own git worktree on
its own branch**. Nothing is committed directly to `main`.

**Branch naming** (extends the convention established by Story 1.1):

```
story/bmad-<epic>-<story>-<slug>
```

Examples:

```
story/bmad-1-1-repo-scaffold-and-pinned-runtimes
story/bmad-1-2-main-uncommittable-with-worktree-isolation
```

**Creating a worktree for a unit of work:**

```bash
# from the main checkout:
git fetch origin
git worktree add -b story/bmad-1-2-main-uncommittable-with-worktree-isolation \
  ../folio-1-2 origin/main
cd ../folio-1-2
npm install        # root deps
npm run setup      # activate the versioned pre-commit hook in this worktree
```

Each worktree has its own working tree and its own checked-out branch, so two
units of work never share a working directory. Land changes via a pull request;
never push to `main` directly.

---

## 2. `main` is physically uncommittable (AC1)

A versioned, in-repo pre-commit hook (`hooks/pre-commit`) rejects any `git commit`
attempted while `HEAD` is on `main`. It is activated by a single checked-in step:

```bash
npm run setup
```

`npm run setup` runs `git config extensions.worktreeConfig true` followed by
`git config --worktree core.hooksPath <root>/hooks`, pointing this worktree's git
at the committed `hooks/` directory. The setting is **versioned** (the hook lives
in the repo, unlike `.git/hooks`), **installed by one command** (not a per-machine
manual habit), and **per-worktree independent** — it lives in this worktree's own
`config.worktree`, so removing one worktree cannot disable another's (or `main`'s)
hook. It is idempotent — safe to re-run after every `git pull`.

Run `npm run setup` once after clone **and** in every new worktree. (Each
worktree's hook setting lives in its own `config.worktree`, so setup must be run
in each worktree to activate the hook there.)

**Scope — local direct commits only.** This hook protects against _local_ direct
commits to `main`. Remote PR merges via GitHub do not run local hooks, so they are
intentionally unaffected.

> **Deferred (out of scope for 1.2):** GitHub remote branch protection — requiring
> a pull request, review, and passing status checks before merge — is a separate,
> later concern. The local hook is a guardrail, not a complete protection scheme.
> Do not attempt to "fully" protect `main` via hooks alone.

---

## 3. Same-file work is an implicit dependency — serialise it

Worktrees isolate working trees, but they do **not** merge for you. If two units of
work touch **the same file**, the second to merge will hit a conflict and risks
orphaning or regressing the first.

**Rule:** work that touches the same file(s) across units is an **implicit
dependency** and must be **serialised** — finish and merge one before starting (or
rebasing onto) the next. Cross-unit work touching the same file must be sequenced,
not parallelised.

Practical checks before starting parallel work:

- Does my change touch a file another in-flight unit also changes? If yes, sequence
  the units (or split the shared file's concerns so each unit owns a distinct
  module).
- When rebasing a long-lived worktree onto `main`, re-run `npm run setup` (hook
  config is per-worktree) and `npm test` before merging.

---

## 4. Per-worktree dev-environment isolation (AC3)

Running the relay dev server, the puller, and the dedupe store for local dev or
integration tests uses **per-worktree ports and state paths** so concurrent runs
across worktrees are very unlikely to collide (the vehicle-agent port-collision scar,
pre-empted).

`npm run dev` sources `scripts/dev-env.sh`, which derives a **stable, deterministic
offset from the worktree's path** and exports:

| Variable                     | Meaning                                            |
| ---------------------------- | -------------------------------------------------- |
| `FOLIO_RELAY_PORT`           | Port for `wrangler dev` (relay dev server)         |
| `FOLIO_RELAY_INSPECTOR_PORT` | Distinct wrangler inspector port                   |
| `FOLIO_PULLER_PORT`          | Port the puller listens on                         |
| `FOLIO_TARGET_DIR`           | Per-worktree Target (write) directory              |
| `FOLIO_DEDUPE_DIR`           | Per-worktree dedupe store directory                |
| `FOLIO_WORKTREE_HASH`        | Short stable hash of the worktree path (for state) |

State lives under a **gitignored** `.worktree-state/<hash>/` at the worktree root
(the Target dir and dedupe store). No payload is committed.

**Determinism contract:** the same worktree path produces identical values on
every run. Two different worktrees get distinct hashes (and therefore distinct
state directories — effectively collision-free).

> **Port isolation is probabilistic, not guaranteed.** Ports are selected from a
> window of `FOLIO_PORT_RANGE` (default **999**) strided slots, so two distinct
> worktrees can in principle share a slot (birthday bound: ~24 concurrent
> worktrees ≈ 50% chance of a single collision) even though their state dirs
> differ. For typical solo/small-team dev this is comfortably unlikely; raise
> `FOLIO_PORT_RANGE` for more headroom, or add an explicit port-probe if you need
> a hard guarantee.

**Cleanup:** the dev script installs an `EXIT` trap that stops the spawned relay
and puller processes and removes this worktree's `.worktree-state/<hash>/`
directory on normal exit. If a shell is killed (SIGKILL, power loss), the
`.worktree-state/<hash>/` dir may be orphaned; recover with:

```bash
rm -rf .worktree-state/<hash>      # or simply: rm -rf .worktree-state
```

This is deliberately **not** a compose/orchestration framework — it is a sourced
derivation helper plus an EXIT trap. Orchestration belongs to later deployment
stories.

---

## 5. Running the tests

```bash
npm test      # repo-level vitest suite (acceptance + guardrail tests), root
```

Tests live in `tests/` and follow the convention established by `tests/scaffold.test.ts`.
The hook test (`tests/hooks.test.ts`) spins up an isolated temp git repo so it never
touches the real repository's state. The dev-env test (`tests/dev-env.test.ts`)
exercises the derivation as a pure unit (no live `wrangler dev` run). The CI test
(`tests/ci.test.ts`) pins the two-tier-CI configuration and the risk-tier
classification (Story 1.3).

To run the suite WITH coverage (as CI does):

```bash
npm run test:ci   # vitest run --coverage; enforces rigour-seam thresholds
```

## 6. Standards

See [`standards.md`](standards.md) for the repo's quality criteria
(story-aligned diffs, tests-cover-acs, typed errors).

## 7. Two-tier CI

Quality is enforced at **two tiers** (Story 1.3, AR-3): a fast **local** tier
and a comprehensive **CI** tier. The split exists so the local hook is never
slow enough to be fought and skipped.

### Local tier — fast, in the pre-commit hook

The versioned `hooks/pre-commit` runs only **fast** checks on **staged files
only** (never the whole tree, which is what keeps it fast):

1. Block direct commits to `main` (Story 1.2).
2. A `prettier --check` on the staged files (format drift fails the commit).

It deliberately does **not** run the slow gates (build, full test suite, secret
scan, CVE scan, coverage). Anything slower than "feels instant" belongs in CI;
a slow local hook gets fought and skipped, which defeats the point. Fix a format
failure with `npm run format`, then re-stage and commit.

### CI tier — comprehensive, on the self-hosted runner

`.github/workflows/ci.yml` runs on every push to `main` and every pull request,
on the self-hosted GitHub Actions runner. From the **first** CI run it:

- installs **frozen** (`npm ci` for root, relay, and puller — no lockfile drift),
- runs the **build** (`tsc --noEmit`) and the **full test suite with coverage**
  (enforcing the rigour-seam thresholds, §8),
- runs a **secret scan** (gitleaks, pinned config in `.gitleaks.toml`), and
- runs a **dependency CVE scan** (`npm audit --audit-level=high`).

A planted test secret and a known-vulnerable pinned dependency each fail CI —
proven by fixture-proof steps that exercise `scripts/secret-scan.sh --fixtures`
and `npm audit` against `tests/fixtures/`. The fixtures are clearly-fake
(FAKE/TEST-FIXTURE markers) and live only under `tests/fixtures/`; the production
scans exclude the leak fixture so the planted secret never trips the real gate.

**Runner prerequisites:** the self-hosted runner needs Node 24, npm, and gitleaks
on PATH. (The deploy runbook in Epic 6 covers runner setup.) Locally,
`npm run secret-scan` / `npm run audit` run the same scans if gitleaks is installed.

## 8. Coverage thresholds and risk tiers

### Coverage thresholds on the rigour seams (AR-13)

`vitest.config.ts` enforces high coverage thresholds (90%) on the three
**rigour seams** — the security-critical paths where coverage gaps hide real
risk:

- `relay/src/auth` — the operator-gating surface,
- `puller/src/write` — the sole-writer boundary, path containment, integrity,
- `puller/src/dedupe` — the idempotent reconciliation store.

These seams are placeholders today; the thresholds are **armed, not bypassed** —
0 statements trivially satisfy 100%. When a later story adds real
implementation, a coverage regression fails CI.

### Risk-tier classification (AR-12)

[`docs/risk-tiers.yaml`](risk-tiers.yaml) declares which change paths are
**human-gated** (require a human to merge — never auto-merged) versus
**auto-mergeable** (may machine-merge once CI is green):

- **Human-gated:** auth, the write path, the frame protocol, Dockerfiles,
  docker-compose, CI config, deploy tooling, pinned runtimes/lockfiles, and the
  CI/classification machinery itself.
- **Auto-mergeable:** docs, tests, and additive non-sensitive work.
- **Default (unknown path):** fail-closed → human-gated.

The auto-merge **mechanism** itself is provided by the Flow build path; Folio
owns only this classification (the single source of truth for path sensitivity).
Changing the rules in `risk-tiers.yaml` is itself human-gated.
