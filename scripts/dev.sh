#!/usr/bin/env bash
# dev.sh — root dev launcher (`npm run dev`) for Story 1.2 (AC3 / T3.3, T3.6).
#
# Sources the per-worktree derivation helper (scripts/dev-env.sh), creates this
# worktree's isolated state dirs, then starts the relay (wrangler dev) and the
# puller on their isolated ports. An EXIT trap stops both processes and removes
# this worktree's .worktree-state/<hash>/ on exit so nothing is orphaned.
#
# This is deliberately NOT orchestration: it is a sourced derivation + an EXIT
# trap. Orchestration belongs to later deployment stories.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Source the per-worktree derivation helper. Sourcing exports the FOLIO_* env.
# shellcheck source=dev-env.sh
. "$ROOT/scripts/dev-env.sh"

# Create this worktree's isolated state directories (Target + dedupe store).
mkdir -p "$FOLIO_TARGET_DIR" "$FOLIO_DEDUPE_DIR"

# Child process tracking for cleanup.
_RELAY_PID=""
_PULLER_PID=""
_STATE_DIR="$(dirname "$FOLIO_TARGET_DIR")"   # .../<worktree>/.worktree-state/<hash>

# NOTE (intent): cleanup() below does `rm -rf "$_STATE_DIR"`, which holds BOTH the
# Target dir AND the dedupe store path for this worktree. Today (Story 1.2) the
# dedupe store is NOT yet built -- only an empty FOLIO_DEDUPE_DIR path is plumbed --
# so this wipe is harmless and dedupe state is ephemeral per `npm run dev` session.
# ARCHITECTURAL CONSTRAINT (AR-9, FR-13): the real dedupe store is DURABLE and MUST
# survive restarts (7-day retention; the reconciliation source of truth). It is built
# in Story 3.5 (create-when-needed). When 3.5 lands the real store, it MUST live
# OUTSIDE .worktree-state/<hash>/ -- which this EXIT trap owns -- so the trap never
# wipes durable state. The Target dir (transient payload copy) may stay under here;
# the dedupe store must not.

cleanup() {
  local rc=$?
  set +e
  if [[ -n "$_RELAY_PID" ]];  then kill "$_RELAY_PID"  2>/dev/null || true; fi
  if [[ -n "$_PULLER_PID" ]]; then kill "$_PULLER_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  rm -rf "$_STATE_DIR" 2>/dev/null || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

# Relay: wrangler dev on the isolated relay + inspector ports (T3.3).
# `npx --no-install` resolves wrangler from relay/'s own node_modules without
# prompting to install — it fails fast if the contributor hasn't run `npm ci`
# in relay/ yet.
(
  cd "$ROOT/relay"
  exec npx --no-install wrangler dev --port "$FOLIO_RELAY_PORT" --inspector-port "$FOLIO_RELAY_INSPECTOR_PORT"
) &
_RELAY_PID=$!

# Puller: reads its port + Target/dedupe paths from the exported env (T3.4).
(
  cd "$ROOT/puller"
  exec npm run start
) &
_PULLER_PID=$!

# Block until either child exits; the trap cleans both up.
wait
