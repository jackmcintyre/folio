/**
 * Legibility tests — Story 1.8 (Context legibility, guardrail docs, and tracing
 * scaffold).
 *
 * AC1: a short, current CLAUDE.md with module-scoped rules for relay/ and
 *      puller/, an anti-pattern log seeded with the AD-6 containment deviation,
 *      a primitive allow-list (one vetted lib per primitive, hand-rolling
 *      forbidden, path handling the documented exception), and AR-13 mandatory
 *      consult-points for the three rigour seams.
 *      Each top-level rule references the current ARCHITECTURE-SPINE version,
 *      and a check asserts that version matches the checked-in spine.
 * AC2: the rulebook (docs/standards.md) is bounded — at most 10 named MUST
 *      rules, cap enforced here (CI fails if exceeded).
 *
 * These are pure file-shape assertions: the guardrail docs are machine-checked
 * so an agent's day-one context cannot silently drift.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}

// ────────────────────────────────────────────────────────────────────────────
// AC1 — CLAUDE.md: short, current, module-scoped, spine-version-checked.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — CLAUDE.md is present, short, and module-scoped", () => {
  let claude: string;

  it("CLAUDE.md exists at the repo root", () => {
    const p = resolve(ROOT, "CLAUDE.md");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).isFile()).toBe(true);
    claude = read("CLAUDE.md");
    expect(claude.trim().length).toBeGreaterThan(0);
  });

  it("is ≤ 200 lines (legible)", () => {
    claude = read("CLAUDE.md");
    expect(lineCount(claude)).toBeLessThanOrEqual(200);
  });

  it("carries module-scoped rules for relay/ and puller/", () => {
    claude = read("CLAUDE.md");
    expect(claude).toMatch(/relay\//);
    expect(claude).toMatch(/puller\//);
  });
});

describe("AC1 — every top-level rule cites the checked-in spine version", () => {
  let claude: string;
  let spine: string;

  it("the checked-in spine (docs/architecture-spine.md) declares a version", () => {
    spine = read("docs/architecture-spine.md");
    expect(spine).toMatch(/^version:\s*["'](\S+)["']/m);
  });

  it("CLAUDE.md has ≤ 10 top-level rules (each carries a spine marker)", () => {
    claude = read("CLAUDE.md");
    const markers = [...claude.matchAll(/spine=([^\s>]+)/g)];
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.length).toBeLessThanOrEqual(10);
  });

  it("every spine citation matches the checked-in spine version", () => {
    claude = read("CLAUDE.md");
    spine = read("docs/architecture-spine.md");
    const spineVersion = spine.match(/^version:\s*["'](\S+)["']/m)![1];
    const cited = [...claude.matchAll(/spine=([^\s>]+)/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(0);
    // Every cited version is the current spine version — no stale rules.
    for (const v of cited) {
      expect(v).toBe(spineVersion);
    }
    // And there is exactly one distinct cited version (no mixed versions).
    expect(new Set(cited).size).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — anti-pattern log seeded with the AD-6 containment-library deviation.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — anti-pattern log seeded with AD-6", () => {
  it("docs/anti-patterns.md exists", () => {
    expect(existsSync(resolve(ROOT, "docs", "anti-patterns.md"))).toBe(true);
  });

  it("records the AD-6 containment no-library deviation", () => {
    const log = read("docs/anti-patterns.md");
    expect(log).toMatch(/AD-6/);
    expect(log).toMatch(/containment/i);
    expect(log).toMatch(/no.*vetted.*library|no.*third-party.*library|no vetted/i);
    expect(log).toMatch(/puller\/src\/write/);
    // The deviation must be recorded as signed-off, not silent.
    expect(log).toMatch(/sign/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — primitive allow-list: one vetted lib per primitive, hand-rolling
// forbidden, path handling the documented exception.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — primitive allow-list", () => {
  let allow: string;

  it("docs/primitive-allowlist.md exists", () => {
    expect(existsSync(resolve(ROOT, "docs", "primitive-allowlist.md"))).toBe(true);
    allow = read("docs/primitive-allowlist.md");
  });

  const PRIMITIVES: Array<[string, RegExp]> = [
    ["OAuth/auth", /oauth|auth/i],
    ["ID generation", /id[\s-]*generation|correlation/i],
    ["rate-limiting", /rate[\s-]*limit/i],
    ["time/timezone", /time[\s/]*time?zone|timezone/i],
  ];
  for (const [name, re] of PRIMITIVES) {
    it(`names a vetted library for: ${name}`, () => {
      allow = read("docs/primitive-allowlist.md");
      expect(allow).toMatch(re);
    });
  }

  it("forbids hand-rolling the named primitives", () => {
    allow = read("docs/primitive-allowlist.md");
    expect(allow).toMatch(/hand-roll|do not hand-roll|don't hand-roll|forbid/i);
  });

  it("documents path handling as the AD-6 exception (no vetted lib)", () => {
    allow = read("docs/primitive-allowlist.md");
    expect(allow).toMatch(/path handling|path containment|containment/i);
    expect(allow).toMatch(/AD-6|exception/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — AR-13 mandatory consult-points for the three rigour seams.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — AR-13 consult-points for the rigour seams", () => {
  let rules: string;

  it("consult-points are declared (CLAUDE.md + spine)", () => {
    rules = read("CLAUDE.md");
    const spine = read("docs/architecture-spine.md");
    expect(rules).toMatch(/consult[- ]point|consult before|consult:/i);
    // The spine also carries the seam table.
    expect(spine).toMatch(/rigour seam|consult-point|consult before/i);
  });

  const SEAMS = ["relay/src/auth", "puller/src/write", "puller/src/dedupe"];
  for (const seam of SEAMS) {
    it(`consult-point exists for ${seam}`, () => {
      rules = read("CLAUDE.md");
      // The seam must appear in a consult-point context (not just a passing
      // mention) — the CLAUDE.md consult-points section names each one.
      expect(rules).toContain(seam);
    });
  }

  it("the consult-points reference the binding invariants (AD-n)", () => {
    rules = read("CLAUDE.md");
    // Each seam's consult row cites at least one AD invariant.
    expect(rules).toMatch(/AD-10/);
    expect(rules).toMatch(/AD-6/);
    expect(rules).toMatch(/AD-5|AD-19|AD-21/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — bounded rulebook: docs/standards.md MUST rules capped at 10 (enforced).
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — rulebook MUST rules are capped (CI fails if exceeded)", () => {
  let standards: string;

  it("docs/standards.md declares a must_rule_cap", () => {
    standards = read("docs/standards.md");
    expect(standards).toMatch(/must_rule_cap:\s*\d+/);
  });

  it("the cap is ≤ 10 (the rulebook stays legible)", () => {
    standards = read("docs/standards.md");
    const cap = Number.parseInt(standards.match(/must_rule_cap:\s*(\d+)/)![1]!, 10);
    expect(cap).toBeLessThanOrEqual(10);
  });

  it("the count of MUST rules does not exceed the cap (the enforced gate)", () => {
    standards = read("docs/standards.md");
    const cap = Number.parseInt(standards.match(/must_rule_cap:\s*(\d+)/)![1]!, 10);

    // Isolate the must_rules block: from "must_rules:" up to the next top-level
    // key ("criteria:"), so review criteria are never mis-counted as MUST rules.
    const start = standards.indexOf("must_rules:");
    expect(start).toBeGreaterThanOrEqual(0);
    const after = standards.slice(start);
    const endRel = after.indexOf("\ncriteria:");
    const block = endRel >= 0 ? after.slice(0, endRel) : after;

    const mustRuleCount = [...block.matchAll(/^\s*-\s+name:/gm)].length;
    expect(mustRuleCount).toBeGreaterThan(0);
    // THE GATE: this assertion fails CI the moment the cap is exceeded.
    expect(mustRuleCount).toBeLessThanOrEqual(cap);
  });

  it("the existing review criteria are preserved (Flow reviewer depends on them)", () => {
    standards = read("docs/standards.md");
    expect(standards).toMatch(/criteria:/);
    expect(standards).toMatch(/story-aligned/);
    expect(standards).toMatch(/tests-cover-acs/);
  });
});
