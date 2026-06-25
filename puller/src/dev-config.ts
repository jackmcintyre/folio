// Puller dev-time configuration plumbing (Story 1.2, T3.4).
//
// The puller reads its port and its Target/dedupe paths from the per-worktree
// dev environment exported by scripts/dev-env.sh (see docs/contributing.md §4).
// There are NO hard-coded paths or ports here: concurrent worktrees stay
// isolated because each one derives distinct values.
//
// This is config plumbing only. The outbound-channel / runtime logic is the
// subject of later stories (Epic 2) and is deliberately not implemented here.
//
// (The repo's typed-error standard, docs/standards.md "errors-are-typed",
// anticipates a DomainError hierarchy that does not yet exist in folio; a plain
// Error is used for this dev-config plumbing until that class lands in-story.)

export interface PullerDevConfig {
  /** Port the puller listens on (FOLIO_PULLER_PORT). */
  readonly port: number;
  /** Per-worktree Target (write) directory (FOLIO_TARGET_DIR). */
  readonly targetDir: string;
  /** Per-worktree dedupe store directory (FOLIO_DEDUPE_DIR). */
  readonly dedupeDir: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Puller dev config: required environment variable ${name} is not set. ` +
        "Run 'npm run dev' from the repo root (it sources scripts/dev-env.sh) " +
        "or source scripts/dev-env.sh in your shell before starting the puller.",
    );
  }
  return value;
}

export function loadDevConfig(): PullerDevConfig {
  const rawPort = requiredEnv("FOLIO_PULLER_PORT");
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `Puller dev config: FOLIO_PULLER_PORT is not a valid port (got "${rawPort}").`,
    );
  }
  return {
    port,
    targetDir: requiredEnv("FOLIO_TARGET_DIR"),
    dedupeDir: requiredEnv("FOLIO_DEDUPE_DIR"),
  };
}
