// Folio ESLint flat config — architectural-invariant lint + legibility ceilings
// (Story 1.4). Realises AD-1 (layering law + no-Claude/KB identifiers) and
// NFR-5 (complexity / nesting / file-size / function-size / dead-code ceilings).
//
// This is the root-level lint substrate (mirrors the root `check` = tsc and root
// `test` = vitest pattern; there are no npm workspaces). It is invoked by
// `npm run lint` and stands alone — Story 1.3's CI calls it; this story creates
// no workflow file. The gate exits non-zero on any violation so 1.3 can adopt it
// unchanged.
//
// Design choices:
//   - Type-UNAWARE (no projectService / parserOptions.project): the AC1/AC2/AC3
//     rules are purely syntactic/textual and need no type info, which keeps the
//     gate fast and free of tsconfig-resolution fragility across the four
//     independent tsconfigs.
//   - NO recommended preset is enabled: only the rules named below are active,
//     so the gate can only fire on behaviour the ACs enumerate (no surprise
//     flags on legitimate cross-cutting code).
//   - The per-function / per-file ceilings are scoped to PRODUCT SOURCE only
//     (relay/src, puller/src, shared). Tests and config are exempt from the
//     size ceilings (a test file legitimately runs long; the ceilings protect
//     product legibility, especially the rigour seams).
//   - Ceiling values are recorded in docs/standards.md (an explicit AC3
//     deliverable). Tune them there and here together.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import folioPlugin from "./eslint-rules/folio-plugin.js";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

// Product source — where the architecture's legibility ceilings bite.
const PRODUCT_SOURCE = ["relay/src/**/*.ts", "puller/src/**/*.ts", "shared/**/*.ts"];

export default tseslint.config(
  // 1. Global ignores — never linted.
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      "**/package-lock.json",
      "coverage/**",
      "dist/**",
      "build/**",
      "_bmad-output/**",
      "_bmad/**",
      ".flow/**",
      ".wrangler/**",
      "**/.wrangler/**",
      "tests/fixtures/**",
      "*.local",
    ],
  },

  // 2. Product source: parse as TypeScript, enforce the AC3 ceilings + dead-code.
  //    The @typescript-eslint plugin is registered for the TS-aware no-unused-vars.
  {
    files: PRODUCT_SOURCE,
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      folio: folioPlugin,
    },
    rules: {
      // AC3 — complexity & legibility ceilings (values mirrored in docs/standards.md).
      complexity: ["error", 10],
      "max-depth": ["error", 4],
      "max-lines": ["error", 300],
      "max-lines-per-function": ["error", 60],
      // AC3 — dead-code: unreachable code + unused variables (the canonical AC3
      // definition). Broader unused-export/file detection is the separate knip
      // gate (`npm run lint:dead-code`); duplication is the separate jscpd gate.
      "no-unreachable": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  // 3. AC1 — AD-1 layering law: the handler core imports only the Backend port.
  //    Scoped to relay/src/handler/** so transport/backend/broker are unaffected.
  {
    files: ["relay/src/handler/**/*.ts"],
    plugins: { folio: folioPlugin },
    rules: {
      "folio/handler-layering": ["error", { repoRoot: REPO_ROOT }],
    },
  },

  // 4. AC2 — AD-1 companion: no Claude/KB identifiers in relay/ or puller/.
  //    shared/ is intentionally OUT of scope (the frame protocol is a neutral
  //    wire format, and shared/ carries no product vocabulary constraint).
  {
    files: ["relay/src/**/*.ts", "puller/src/**/*.ts"],
    plugins: { folio: folioPlugin },
    rules: {
      "folio/no-claude-kb-identifiers": "error",
    },
  },
);
