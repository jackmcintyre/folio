import { defineConfig } from "vitest/config";

// Vitest config — Folio (Story 1.1 scaffold; coverage added Story 1.3 AC3).
//
// `npm test` runs the suite; `npm run test:ci` runs it WITH coverage so the
// rigour-seam thresholds (below) are enforced in CI. The thresholds target the
// three rigour seams from AR-13: relay/src/auth, puller/src/write,
// puller/src/dedupe. These seams are placeholders today; the thresholds engage
// (and CI fails on a regression) once each seam gains real implementation in
// its owning story. Until then the seams have no executable statements, so a
// 100% threshold is trivially satisfied — the gate is armed, not bypassed.
//
// Per-AC: "high coverage thresholds are enforced on the rigour seams". The
// numbers below (90%) are deliberately high: these are the security-critical
// paths where coverage gaps hide real risk.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // Only the rigour seams are threshold-gated (AR-13). The rest of the tree
      // is scaffold/placeholder and is reported but not gated.
      include: ["relay/src/auth/**/*.ts", "puller/src/write/**/*.ts", "puller/src/dedupe/**/*.ts"],
      thresholds: {
        // High bar, applied across the three rigour seams combined.
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
