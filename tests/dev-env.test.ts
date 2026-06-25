/**
 * Dev-env tests — AC3 for Story 1.2 (per-worktree port + volume/store isolation).
 *
 * Exercises scripts/dev-env.sh as a PURE derivation (no processes spawned, no
 * directories created — not a live `wrangler dev` run). Asserts determinism
 * (same worktree path -> identical values) and isolation (distinct worktree
 * paths -> distinct hashes, state dirs, and ports).
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DEV_ENV = join(ROOT, "scripts", "dev-env.sh");

const KEYS = [
  "FOLIO_WORKTREE_PATH",
  "FOLIO_WORKTREE_HASH",
  "FOLIO_RELAY_PORT",
  "FOLIO_RELAY_INSPECTOR_PORT",
  "FOLIO_PULLER_PORT",
  "FOLIO_TARGET_DIR",
  "FOLIO_DEDUPE_DIR",
] as const;

interface Derived {
  [k: string]: string;
}

function derive(worktreePath: string, extra: Record<string, string> = {}): Derived {
  const stdout = execFileSync("bash", [DEV_ENV], {
    encoding: "utf8",
    env: { ...process.env, FOLIO_WORKTREE_PATH: worktreePath, ...extra },
  });
  const out: Derived = {};
  for (const line of stdout.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

// Type-narrowing accessor: with noUncheckedIndexedAccess, `Derived[key]` is
// `string | undefined`; this asserts presence (the derivation emits every key)
// and returns a concrete `string` for the well-formedness checks below.
function val(d: Derived, key: string): string {
  const v = d[key];
  if (v === undefined) throw new Error(`missing derived key: ${key}`);
  return v;
}

const ALPHA = "/tmp/folio-wt-alpha";
const BETA = "/tmp/folio-wt-beta";

describe("AC3 — dev-env derivation is deterministic", () => {
  it("emits every documented FOLIO_* variable", () => {
    const d = derive(ALPHA);
    for (const key of KEYS) {
      expect(d[key], `${key} should be emitted`).toBeTruthy();
    }
  });

  it("produces identical output across repeated runs of the same worktree", () => {
    const first = derive(ALPHA);
    const second = derive(ALPHA);
    expect(second).toEqual(first);
  });
});

describe("AC3 — dev-env isolates distinct worktrees", () => {
  it("gives two worktrees distinct hashes (=> distinct state dirs)", () => {
    const a = derive(ALPHA);
    const b = derive(BETA);
    expect(a.FOLIO_WORKTREE_HASH).not.toBe(b.FOLIO_WORKTREE_HASH);
  });

  it("gives two worktrees distinct Target and dedupe paths", () => {
    const a = derive(ALPHA);
    const b = derive(BETA);
    expect(a.FOLIO_TARGET_DIR).not.toBe(b.FOLIO_TARGET_DIR);
    expect(a.FOLIO_DEDUPE_DIR).not.toBe(b.FOLIO_DEDUPE_DIR);
  });

  it("gives two worktrees distinct relay ports", () => {
    const a = derive(ALPHA);
    const b = derive(BETA);
    expect(a.FOLIO_RELAY_PORT).not.toBe(b.FOLIO_RELAY_PORT);
    expect(a.FOLIO_PULLER_PORT).not.toBe(b.FOLIO_PULLER_PORT);
  });
});

describe("AC3 — derived values are well-formed", () => {
  const d = derive(ALPHA);

  it("ports are integers in a valid, strided window", () => {
    const relay = Number.parseInt(val(d, "FOLIO_RELAY_PORT"), 10);
    const inspector = Number.parseInt(val(d, "FOLIO_RELAY_INSPECTOR_PORT"), 10);
    const puller = Number.parseInt(val(d, "FOLIO_PULLER_PORT"), 10);
    expect(Number.isInteger(relay)).toBe(true);
    expect(relay).toBeGreaterThan(0);
    expect(relay).toBeLessThan(65536);
    // Stride layout: inspector and puller occupy the slots immediately after relay.
    expect(inspector).toBe(relay + 1);
    expect(puller).toBe(relay + 2);
    // Inspector must not collide with relay or puller.
    expect(inspector).not.toBe(relay);
    expect(inspector).not.toBe(puller);
  });

  it("state paths live under .worktree-state/<hash>/", () => {
    const h = d.FOLIO_WORKTREE_HASH;
    expect(d.FOLIO_TARGET_DIR).toBe(`${ALPHA}/.worktree-state/${h}/target`);
    expect(d.FOLIO_DEDUPE_DIR).toBe(`${ALPHA}/.worktree-state/${h}/dedupe`);
  });

  it("is a pure derivation — it does not create the state directories", () => {
    expect(existsSync(val(d, "FOLIO_TARGET_DIR"))).toBe(false);
    expect(existsSync(val(d, "FOLIO_DEDUPE_DIR"))).toBe(false);
  });
});

describe("AC3 — derivation honours tuning overrides", () => {
  it("FOLIO_PORT_BASE shifts the relay window", () => {
    const base = derive(ALPHA, { FOLIO_PORT_BASE: "20000" });
    const relay = Number.parseInt(val(base, "FOLIO_RELAY_PORT"), 10);
    expect(relay).toBeGreaterThanOrEqual(20000);
    expect(relay).toBeLessThan(20000 + 999 * 4);
  });
});
