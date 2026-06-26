#!/usr/bin/env bash
# secret-scan.sh — Folio secret scan (Story 1.3 AC2, the CI tier).
#
# Runs gitleaks against the repository using the pinned .gitleaks.toml config.
# Present from the FIRST CI run, never added later (AR-3 / NFR-1). Fails (exit 1)
# on any detected secret.
#
# gitleaks is a Go binary (NOT an npm package). CI installs it in-workflow
# (see .github/workflows/ci.yml "Install gitleaks", pinned to v8.30.1);
# locally it is optional. This script requires `gitleaks` on PATH —
# it does not pretend to fetch a non-existent npm package. If gitleaks is not
# installed, it exits non-zero with a clear message (CI is the authoritative
# place the scan runs; the vitest proof verifies the config/fixture/rule
# deterministically without the binary, so the local gate is not gated on it).
#
# Usage:
#   npm run secret-scan                 # scan the whole repo (CI production scan)
#   scripts/secret-scan.sh --fixtures   # scan ONLY the planted fixtures dir
#                                      # (used to prove the scanner fires from
#                                      #  commit one on a planted test secret)
#
# The production scan excludes tests/fixtures/leak-fixtures/ via the config so
# the deliberately-planted fake test secret does not trip the real gate; the
# --fixtures mode exercises exactly that fixture to prove detection works.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/.gitleaks.toml"
# Fixture-proof config: same rule, no allowlist exclusion of the fixture dir.
FIXTURES_CONFIG="$ROOT/.gitleaks.fixtures.toml"
FIXTURES="$ROOT/tests/fixtures/leak-fixtures"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "secret-scan: gitleaks is not installed on PATH." >&2
  echo "Install it (e.g. 'brew install gitleaks' or 'go install github.com/gitleaks/gitleaks/v8@latest')" >&2
  echo "or rely on CI, which installs gitleaks in-workflow and runs this scan authoritatively." >&2
  echo "The vitest proof (tests/ci.test.ts) verifies the config/rule/fixture without the binary." >&2
  exit 127
fi

mode="repo"
if [[ "${1:-}" == "--fixtures" ]]; then
  mode="fixtures"
fi

if [[ "$mode" == "fixtures" ]]; then
  # Fixture scan: we EXPECT exactly one finding (the planted test secret).
  # Uses --no-git so it scans the fixture FILES (not the shared worktree git
  # history), scoped to the fixtures dir. gitleaks exits 1 on findings.
  # Invert: this mode SUCCEEDS when the secret is found, FAILS if detection
  # ever regresses.
  set +e
  gitleaks detect --source "$FIXTURES" --config "$FIXTURES_CONFIG" --no-git --redact --no-banner -v
  rc=$?
  set -e
  if [[ $rc -eq 1 ]]; then
    echo "secret-scan: OK — planted fixture secret detected (scanner is wired correctly)."
    exit 0
  elif [[ $rc -eq 0 ]]; then
    echo "secret-scan: FAIL — gitleaks did NOT detect the planted fixture secret." >&2
    echo "The scanner config may have regressed. See .gitleaks.toml." >&2
    exit 1
  fi
  echo "secret-scan: FAIL — gitleaks errored (exit $rc) scanning the fixture." >&2
  exit "$rc"
fi

# Production repo scan (git mode: scans commit history + working tree of the
# whole repo). A finding (gitleaks exit 1) is a failure. The allowlist in
# .gitleaks.toml excludes the planted-fixture dir so the fake test secret
# doesn't trip this real gate.
set +e
gitleaks detect --source "$ROOT" --config "$CONFIG" --redact --no-banner -v
rc=$?
set -e
if [[ $rc -eq 0 ]]; then
  echo "secret-scan: OK — no secrets detected in the repository."
  exit 0
elif [[ $rc -eq 1 ]]; then
  echo "secret-scan: FAIL — potential secret(s) detected." >&2
  echo "Review the report above; if a finding is a false positive, extend the" >&2
  echo "allowlist in .gitleaks.toml. NEVER commit a real secret." >&2
  exit 1
fi
echo "secret-scan: FAIL — gitleaks errored (exit $rc)." >&2
exit "$rc"
