#!/usr/bin/env bash
# setup.sh — one-shot, idempotent repo bootstrap for contributors (Story 1.2, T1.3).
#
# Activates the versioned, in-repo pre-commit hook by pointing git's core.hooksPath
# at the committed hooks/ directory. This is how the "main is physically
# uncommittable" guarantee (AC1) is installed by a single checked-in step rather
# than a per-machine manual habit.
#
# Run once after clone (and again any time — it is idempotent):
#
#     npm run setup
#
# Per-worktree scope (--worktree): the setting is written to THIS worktree's own
# git config (config.worktree), not the shared .git/config. That removes a real
# footgun: with a shared, absolute core.hooksPath, `git worktree remove` of the
# worktree whose path it pointed at would leave a dangling path that git treats
# as "no hook" -- silently disabling main protection for EVERY checkout.
# Per-worktree config means each checkout owns its own (self-referential) hooks
# path, so removing one worktree cannot disable another's (or main's) protection.
#
# `extensions.worktreeConfig` must be enabled for git to honour per-worktree
# config keys; it is a one-time, repo-wide setting (idempotent here). The hook
# file itself remains the committed hooks/pre-commit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$ROOT/hooks"

if [[ ! -x "$HOOKS_DIR/pre-commit" ]]; then
  echo "folio: ERROR: $HOOKS_DIR/pre-commit missing or not executable." >&2
  echo "Ensure you are at the repo root and run this from a clean checkout." >&2
  exit 1
fi

# Honour per-worktree config keys (one-time, repo-wide, idempotent).
git config extensions.worktreeConfig true
# Point THIS worktree's git at the committed hooks dir, scoped to this worktree.
git config --worktree core.hooksPath "$HOOKS_DIR"
echo "hooks: core.hooksPath -> $HOOKS_DIR (per-worktree)"
echo "hooks: pre-commit now protects 'main' from direct commits."
