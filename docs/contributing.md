# Contributing to Folio

This document defines the **worktree + branch workflow** every unit of work
follows, the **per-worktree dev-environment isolation** that keeps concurrent
runs from colliding, and the **`main` is physically uncommittable** guarantee
that underpins both.

It realises Story 1.2 (AC1, AC2, AC3) and the architecture's Consistency
Convention: *"`main` physically uncommittable; each unit of work in its own
worktree."*

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

`npm run setup` runs `git config core.hooksPath <root>/hooks`, pointing git at the
committed `hooks/` directory. This is **versioned** (the hook lives in the repo,
unlike `.git/hooks`) and **installed by one command** (not a per-machine manual
habit). It is idempotent — safe to re-run after every `git pull`.

Run `npm run setup` once after clone **and** in every new worktree (worktrees do
not share `.git/config` hook settings with the main checkout).

**Scope — local direct commits only.** This hook protects against *local* direct
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
across worktrees never collide (the vehicle-agent port-collision scar,
pre-empted).

`npm run dev` sources `scripts/dev-env.sh`, which derives a **stable, deterministic
offset from the worktree's path** and exports:

| Variable                    | Meaning                                              |
| --------------------------- | ---------------------------------------------------- |
| `FOLIO_RELAY_PORT`          | Port for `wrangler dev` (relay dev server)           |
| `FOLIO_RELAY_INSPECTOR_PORT`| Distinct wrangler inspector port                     |
| `FOLIO_PULLER_PORT`         | Port the puller listens on                           |
| `FOLIO_TARGET_DIR`          | Per-worktree Target (write) directory                |
| `FOLIO_DEDUPE_DIR`          | Per-worktree dedupe store directory                  |
| `FOLIO_WORKTREE_HASH`       | Short stable hash of the worktree path (for state)   |

State lives under a **gitignored** `.worktree-state/<hash>/` at the worktree root
(the Target dir and dedupe store). No payload is committed.

**Determinism contract:** the same worktree path produces identical values on
every run. Two different worktrees get distinct hashes (and therefore distinct
state directories) and distinct port slots within a strided window.

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
exercises the derivation as a pure unit (no live `wrangler dev` run).

## 6. Standards

See [`standards.md`](standards.md) for the repo's quality criteria
(story-aligned diffs, tests-cover-acs, typed errors).
