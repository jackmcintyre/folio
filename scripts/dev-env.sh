#!/usr/bin/env bash
# dev-env.sh — per-worktree dev-environment isolation (Story 1.2, AC3 / T3.1-T3.2).
#
# Derives a STABLE, DETERMINISTIC offset from the worktree's path so that two
# worktrees running dev/test concurrently get DISTINCT ports and state dirs
# (the vehicle-agent port-collision scar, pre-empted).
#
# Usage:
#   - Sourced by scripts/dev.sh (and by contributors): `source scripts/dev-env.sh`
#     exports the FOLIO_* variables into the current shell.
#   - Executed directly by tooling/tests: `bash scripts/dev-env.sh`
#     prints `KEY=VALUE` lines (a pure derivation, no processes spawned, no dirs
#     created) so callers can parse the scheme without a shell import.
#
# Determinism contract: the same worktree path yields identical values on every
# run. Two distinct paths yield distinct hashes (=> distinct state dirs).
#
# PORT isolation is *probabilistic*, not guaranteed: ports are selected from a
# window of FOLIO_PORT_RANGE (default 999) strided slots, so two distinct paths
# CAN in principle land on the same slot (birthday bound: ~24 concurrent
# worktrees ~= 50% chance of one collision). State-dir isolation (12 hex digits)
# is, by contrast, effectively collision-free. Raise FOLIO_PORT_RANGE for more
# headroom; add an explicit port-probe if a hard guarantee is ever needed.
#
# Exports:
#   FOLIO_WORKTREE_PATH          resolved worktree root used for derivation
#   FOLIO_WORKTREE_HASH          short stable hash (12 hex) of that path
#   FOLIO_RELAY_PORT             `wrangler dev` port (relay dev server)
#   FOLIO_RELAY_INSPECTOR_PORT   distinct wrangler inspector port
#   FOLIO_PULLER_PORT            port the puller listens on
#   FOLIO_TARGET_DIR             per-worktree Target (write) directory
#   FOLIO_DEDUPE_DIR             per-worktree dedupe store directory
#   FOLIO_RELAY_URL              ws:// URL the puller dials out to (derived from
#                                FOLIO_RELAY_PORT unless overridden)
#   FOLIO_PULLER_BEARER          static hop bearer for the dev puller (DEV STUB
#                                only — a real operator-gated secret lands in
#                                Epic 4; override FOLIO_PULLER_BEARER to use one)
#
# Tunables (override via env before sourcing/executing):
#   FOLIO_WORKTREE_PATH  force the worktree path (used by tests)
#   FOLIO_PORT_BASE      first port in the window           (default 9000)
#   FOLIO_PORT_STRIDE    ports reserved per worktree         (default 4)
#   FOLIO_PORT_RANGE     number of distinct worktree slots   (default 999)
#
# Note: no global `set -e` here — this file is sourced into interactive shells
# where strict mode would surprise the caller. Each helper guards its own work.

# Resolve the worktree path: explicit override wins, else git toplevel, else cwd.
_folio_worktree_path() {
  if [[ -n "${FOLIO_WORKTREE_PATH:-}" ]]; then
    printf '%s' "$FOLIO_WORKTREE_PATH"
  else
    git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD"
  fi
}

# Deterministic SHA-256 of the path (portable: shasum on macOS, sha256sum on
# Linux, cksum CRC32 as a last-resort fallback). Prints the hex digest only.
_folio_hash() {
  local path="$1" raw
  if command -v shasum >/dev/null 2>&1; then
    raw="$(printf '%s' "$path" | shasum -a 256)"
  elif command -v sha256sum >/dev/null 2>&1; then
    raw="$(printf '%s' "$path" | sha256sum)"
  else
    printf 'WARNING: neither shasum nor sha256sum found; falling back to cksum (CRC-32). Isolation may weaken under many concurrent worktrees.\n' >&2
    local crc
    crc="$(printf '%s' "$path" | cksum)"
    crc="${crc%% *}"
    printf '%x' "$crc"
    return 0
  fi
  printf '%s' "${raw%% *}"
}

# Fold a hex hash into [0, range) using its first 8 hex digits.
_folio_offset() {
  local hex="$1" range="$2" short dec
  short="${hex:0:8}"
  while [[ ${#short} -lt 8 ]]; do short="0${short}"; done
  dec=$(( 16#$short ))
  printf '%d' $(( dec % range ))
}

# Derive and export the full FOLIO_* environment. Pure: no processes spawned,
# no directories created. Idempotent.
folio_dev_env_derive() {
  local path hex hash12 base stride range offset relay_base
  path="$(_folio_worktree_path)"
  hex="$(_folio_hash "$path")"
  if [[ -z "$hex" ]] || ! [[ "$hex" =~ ^[0-9a-f]+$ ]]; then
    printf 'ERROR: failed to compute a valid hash for "%s" (got "%s")\n' "$path" "$hex" >&2
    return 1
  fi
  hash12="${hex:0:12}"
  base="${FOLIO_PORT_BASE:-9000}"
  stride="${FOLIO_PORT_STRIDE:-4}"
  range="${FOLIO_PORT_RANGE:-999}"

  if [[ "$range" -lt 1 ]]; then
    printf 'folio(dev-env): ERROR: FOLIO_PORT_RANGE must be >= 1 (got %s)\n' "$range" >&2
    return 1
  fi

  if (( base < 1 || base > 65535 )); then
    printf 'ERROR: FOLIO_PORT_BASE must be in [1, 65535] (got %s)\n' "$base" >&2
    return 1
  fi
  local _max_port=$(( base + (range - 1) * stride + 2 ))
  if (( _max_port > 65535 )); then
    printf 'ERROR: derived ports would exceed 65535 (max=%s). Lower FOLIO_PORT_BASE/STRIDE/RANGE.\n' "$_max_port" >&2
    return 1
  fi

  offset="$(_folio_offset "$hex" "$range")"
  relay_base=$(( base + offset * stride ))

  export FOLIO_WORKTREE_PATH="$path"
  export FOLIO_WORKTREE_HASH="$hash12"
  export FOLIO_RELAY_PORT="$relay_base"
  export FOLIO_RELAY_INSPECTOR_PORT=$(( relay_base + 1 ))
  export FOLIO_PULLER_PORT=$(( relay_base + 2 ))
  export FOLIO_TARGET_DIR="$path/.worktree-state/$hash12/target"
  export FOLIO_DEDUPE_DIR="$path/.worktree-state/$hash12/dedupe"

  # The outbound channel (Story 2.1): where the puller dials out, and the dev
  # stub bearer it presents. The URL derives from the relay port; the bearer is
  # a DEV-ONLY stub — never a real secret (override FOLIO_PULLER_BEARER, or wait
  # for Epic 4's operator-gated auth). Both honour a caller-provided override.
  export FOLIO_RELAY_URL="${FOLIO_RELAY_URL:-ws://localhost:$relay_base}"
  export FOLIO_PULLER_BEARER="${FOLIO_PULLER_BEARER:-dev-stub-bearer-change-me}"
}

# True when this file is being sourced rather than executed directly.
_folio_is_sourced() {
  [[ "${BASH_SOURCE[0]:-$0}" != "$0" ]]
}

# Derive on load (covers both the sourced and the executed paths).
folio_dev_env_derive

# When executed directly, emit KEY=VALUE for tooling/tests and stop.
if ! _folio_is_sourced; then
  for var in FOLIO_WORKTREE_PATH FOLIO_WORKTREE_HASH FOLIO_RELAY_PORT FOLIO_RELAY_INSPECTOR_PORT FOLIO_PULLER_PORT FOLIO_TARGET_DIR FOLIO_DEDUPE_DIR FOLIO_RELAY_URL FOLIO_PULLER_BEARER; do
    printf '%s=%s\n' "$var" "${!var}"
  done
  exit 0
fi
