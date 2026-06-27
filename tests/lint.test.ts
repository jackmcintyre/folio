/**
 * Lint tests — AC1, AC2, AC3 for Story 1.4 (Architectural-invariant lint and
 * complexity ceilings).
 *
 * Mutation-checked discipline (the pattern Story 1.2 established): for every
 * gate, plant a fixture that VIOLATES the rule and assert the real lint binary
 * reports the SPECIFIC rule id and exits non-zero; plant a clean fixture and
 * assert it passes. A gate with no test that fails on a planted violation is
 * not done.
 *
 * The tests drive the REAL lint binaries (eslint / jscpd / knip) over fixtures
 * planted in the REAL source paths the flat config scopes rules to, so the
 * entire chain (config scoping -> rule -> report -> exit code) is exercised —
 * not just the rule logic in isolation. Fixtures are transient: they are
 * removed after each test (and swept defensively in afterEach) so they never
 * break the real `npm run lint` or leak into the PR.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BIN = (name: string): string => join(ROOT, "node_modules", ".bin", name);
const ESLINT = BIN("eslint");
const JSCPD = BIN("jscpd");
const KNIP = BIN("knip");

// Probe directories planted inside the real source roots so the flat-config
// `files` globs match them. Each is wiped in afterEach.
const PROBE_DIRS = [
  "relay/src/handler/__lint_probe__",
  "relay/src/__lint_probe__",
  "relay/src/transport/__lint_probe__",
  "puller/src/__lint_probe__",
  "shared/__lint_probe__",
];

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[], cwd: string = ROOT): RunResult {
  try {
    const stdout = execFileSync(bin, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      status: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/** Run the real ESLint gate (`eslint .`) against the whole tree + any probes. */
function eslintAll(): RunResult {
  return run(ESLINT, ["."], ROOT);
}

/** Plant a transient fixture at a path RELATIVE to the repo root. */
function plant(rel: string, content: string): string {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

afterEach(() => {
  for (const dir of PROBE_DIRS) {
    rmSync(join(ROOT, dir), { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — AD-1 layering law: relay/handler must import only the Backend port.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — AD-1 layering law (folio/handler-layering)", () => {
  it("fails when the handler imports the transport adapter", () => {
    plant(
      "relay/src/handler/__lint_probe__/imports-transport.ts",
      `import { something } from "../../transport/index.js";\nexport const probe = something;\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/handler-layering");
  });

  it("fails when the handler imports the filesystem (node:fs/promises)", () => {
    plant(
      "relay/src/handler/__lint_probe__/imports-fs.ts",
      `import { readFileSync } from "node:fs/promises";\nexport const probe = readFileSync;\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/handler-layering");
  });

  it("fails when the handler RE-EXPORTS transport (a bypass via export-from)", () => {
    plant(
      "relay/src/handler/__lint_probe__/reexports-transport.ts",
      `export { something } from "../../transport/index.js";\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/handler-layering");
  });

  it("passes a clean handler that imports only the Backend port", () => {
    // The handler MAY import the Backend port (deliver) — only transport/fs are
    // forbidden. This counter-test guards against the rule over-firing.
    plant(
      "relay/src/handler/__lint_probe__/clean-backend.ts",
      `import { deliver } from "../../backend/index.js";\nexport const probe = deliver;\n`,
    );
    const res = eslintAll();
    expect(res.status).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — no Claude/KB identifiers in relay/ or puller/ (generic-by-contract).
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — no Claude/KB identifiers (folio/no-claude-kb-identifiers)", () => {
  it("fails on the 'claude' token in a relay source string", () => {
    plant("relay/src/__lint_probe__/has-claude.ts", `export const label = "the claude tool";\n`);
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/no-claude-kb-identifiers");
  });

  it("fails on the 'anthropic' token in a puller identifier", () => {
    plant("puller/src/__lint_probe__/has-anthropic.ts", `export const anthropicChannel = 1;\n`);
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/no-claude-kb-identifiers");
  });

  it("fails on the 'knowledge-base' phrase in a comment", () => {
    plant(
      "relay/src/__lint_probe__/has-kb.ts",
      `// syncs to the knowledge-base\nexport const x = 1;\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/no-claude-kb-identifiers");
  });

  it("fails on the 'knowledgebase' token (bare word, no separator)", () => {
    // AC2 enumerates `knowledgebase` as a forbidden bare-word token. The rule
    // matches it case-insensitively as a substring, so plant it in a relay
    // string and assert the rule fires (closes the coverage gap left when only
    // the hyphen/underscore phrases were mutation-tested).
    plant("relay/src/__lint_probe__/has-kb-word.ts", `export const sync = "knowledgebase";\n`);
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/no-claude-kb-identifiers");
  });

  it("fails on the 'knowledge_base' token (underscore separator)", () => {
    // AC2 enumerates `knowledge_base` (underscore) as a forbidden phrase. Plant
    // it in a puller identifier and assert the rule fires.
    plant("puller/src/__lint_probe__/has-kb-underscore.ts", `export const knowledge_base = 1;\n`);
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/no-claude-kb-identifiers");
  });

  it("fails on an @anthropic-ai/* import", () => {
    plant(
      "relay/src/__lint_probe__/anthropic-import.ts",
      `export { Foo } from "@anthropic-ai/sdk";\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("folio/no-claude-kb-identifiers");
  });

  it("does NOT trip on the bare 'kb' substring (feedback / webhook) — kb is excluded", () => {
    // The canonical AC2 excludes the bare token `kb`; words that merely contain
    // the substring must not false-fire.
    plant("relay/src/__lint_probe__/kb-substring.ts", `export const webhook = "feedback loop";\n`);
    const res = eslintAll();
    expect(res.status).toBe(0);
  });

  it("does NOT trip on a Claude/KB token in shared/ — shared is out of scope", () => {
    // Scope guardrail: AC2 applies to relay/src and puller/src ONLY. shared/ is
    // a neutral wire format and is intentionally exempt.
    plant(
      "shared/__lint_probe__/out-of-scope.ts",
      `// mentions claude and knowledgebase\nexport const x = 1;\n`,
    );
    const res = eslintAll();
    expect(res.status).toBe(0);
  });

  it("passes a clean relay/puller source file", () => {
    plant("relay/src/__lint_probe__/clean.ts", `export const greeting = "hello relay";\n`);
    const res = eslintAll();
    expect(res.status).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC3 — complexity / nesting / size / dead-code ceilings (ESLint).
// ────────────────────────────────────────────────────────────────────────────
describe("AC3 — per-function / per-file ceilings bite", () => {
  it("fails on cyclomatic complexity > 10", () => {
    const branches = Array.from({ length: 11 }, (_, i) => `  if (x === ${i}) return ${i};`).join(
      "\n",
    );
    plant(
      "relay/src/transport/__lint_probe__/complex.ts",
      `export function complex(x: number): number {\n${branches}\n  return -1;\n}\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/\bcomplexity\b/);
  });

  it("fails on nesting depth > 4", () => {
    plant(
      "relay/src/transport/__lint_probe__/deep.ts",
      `export function deep(a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): void {\n` +
        `  if (a) { if (b) { if (c) { if (d) { if (e) { const x = 1; } } } } }\n}\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/max-depth/);
  });

  it("fails on a function larger than 60 lines", () => {
    const body = Array.from({ length: 65 }, (_, i) => `  let v${i} = ${i};`).join("\n");
    plant(
      "relay/src/transport/__lint_probe__/bigfn.ts",
      `export function bigFn(): void {\n${body}\n}\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/max-lines-per-function/);
  });

  it("fails on a file larger than 300 lines", () => {
    const lines = Array.from({ length: 305 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    plant("relay/src/transport/__lint_probe__/bigfile.ts", `${lines}\n`);
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/max-lines/);
  });

  it("fails on an unused variable (dead code)", () => {
    plant(
      "relay/src/transport/__lint_probe__/unused.ts",
      `export const used = 1;\nconst flagged = 2;\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("@typescript-eslint/no-unused-vars");
  });

  it("fails on unreachable code (dead code)", () => {
    plant(
      "relay/src/transport/__lint_probe__/unreachable.ts",
      `export function u(): void {\n  return;\n  const after = 1;\n}\n`,
    );
    const res = eslintAll();
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/no-unreachable/);
  });

  it("passes a clean, ceiling-compliant source file", () => {
    plant(
      "relay/src/transport/__lint_probe__/clean.ts",
      `export function simple(x: number): number {\n  if (x > 0) return x;\n  return 0;\n}\n`,
    );
    const res = eslintAll();
    expect(res.status).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC3 — duplication ceiling (jscpd, separate gate).
// ────────────────────────────────────────────────────────────────────────────
describe("AC3 — duplication ceiling bites (jscpd)", () => {
  // A shared block of >=50 tokens (jscpd minTokens=50). Run in an OS temp dir
  // (outside the repo) so the real `npm run lint:dupe` is unaffected and the
  // .jscpd.json ignore patterns do not apply.
  const CLONE_BLOCK = `export function shared(): number {
  const alpha = 1;
  const beta = 2;
  const gamma = 3;
  const delta = 4;
  const epsilon = 5;
  const zeta = 6;
  const eta = 7;
  const theta = 8;
  const iota = 9;
  const kappa = 10;
  const lambda = 11;
  const mu = 12;
  return alpha + beta + gamma + delta + epsilon + zeta + eta + theta + iota + kappa + lambda + mu;
}
`;

  it("fails when two files share a >=50-token clone over the 1% threshold", () => {
    const dir = mkdtempSync(join(tmpdir(), "folio-jscpd-dup-"));
    try {
      writeFileSync(join(dir, "a.ts"), CLONE_BLOCK);
      writeFileSync(join(dir, "b.ts"), CLONE_BLOCK);
      const res = run(JSCPD, [dir], ROOT);
      expect(res.status).not.toBe(0);
      expect(res.stdout).toMatch(/clone/i);
      expect(res.stdout).toMatch(/too many duplicates|threshold/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes two distinct files with no clone", () => {
    const dir = mkdtempSync(join(tmpdir(), "folio-jscpd-clean-"));
    try {
      writeFileSync(join(dir, "a.ts"), `export const only = 1;\n`);
      writeFileSync(join(dir, "b.ts"), `export const other = 2;\n`);
      const res = run(JSCPD, [dir], ROOT);
      expect(res.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC3 — dead-code ceiling for unused exports/files (knip, separate gate).
// ────────────────────────────────────────────────────────────────────────────
describe("AC3 — unused-export/file ceiling bites (knip)", () => {
  it("fails on an unused source file in the product tree", () => {
    // A file in knip's project scope that nothing imports and is not an entry.
    plant(
      "relay/src/transport/__lint_probe__/unused-file.ts",
      `export function neverImported(): string {\n  return "dead";\n}\n`,
    );
    const res = run(KNIP, ["--no-progress"], ROOT);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/Unused/i);
  });

  it("passes on the clean scaffold (no unused exports/files)", () => {
    const res = run(KNIP, ["--no-progress"], ROOT);
    expect(res.status).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Wiring — the scripts and ceiling values are recorded (AC3 deliverable).
// ────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";

describe("AC3 deliverable — scripts + recorded ceiling values", () => {
  it("package.json exposes a lint script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.lint).toMatch(/eslint/);
  });

  it("package.json exposes the duplication and dead-code gates", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["lint:dupe"]).toMatch(/jscpd/);
    expect(pkg.scripts["lint:dead-code"]).toMatch(/knip/);
  });

  it("docs/standards.md records every ceiling value", () => {
    const std = readFileSync(join(ROOT, "docs", "standards.md"), "utf8");
    // Each ceiling the AC enumerates must be recorded (and tunable) here.
    expect(std).toMatch(/complexity-ceilings/);
    expect(std).toMatch(/architectural-invariant-lint/);
    expect(std).toMatch(/<=?\s*10/); // cyclomatic complexity <= 10
    expect(std).toMatch(/<=?\s*4/); // nesting depth <= 4
    expect(std).toMatch(/<=?\s*60/); // function size <= 60
    expect(std).toMatch(/<=?\s*300/); // file size <= 300
    expect(std).toMatch(/50-token/); // duplication min tokens
    expect(std).toMatch(/1%/); // duplication threshold
    // And the version was bumped past the 1.3 baseline.
    expect(std).toMatch(/version:\s*["']0\.[2-9]/);
  });
});
