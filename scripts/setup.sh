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
# An absolute path is used so the hook resolves identically regardless of the
# caller's cwd or git version (relative core.hooksPath resolution has historically
# been version-dependent). The hook file itself remains the committed hooks/pre-commit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$ROOT/hooks"

if [[ ! -x "$HOOKS_DIR/pre-commit" ]]; then
  echo "folio: ERROR: $HOOKS_DIR/pre-commit missing or not executable." >&2
  echo "Ensure you are at the repo root and run this from a clean checkout." >&2
  exit 1
fi

git config core.hooksPath "$HOOKS_DIR"
echo "hooks: core.hooksPath -> $HOOKS_DIR"
echo "hooks: pre-commit now protects 'main' from direct commits."
