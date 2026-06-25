/**
 * Puller dev-config tests — AC3 / T3.4 for Story 1.2.
 *
 * The puller must read its port and its Target/dedupe paths from the exported
 * per-worktree environment (no hard-coded paths). These tests cover that the
 * plumbing resolves correctly and fails loudly when the contract is violated.
 */

import { describe, expect, it, afterEach } from "vitest";
import { loadDevConfig } from "../puller/src/dev-config.js";

const ENV_KEYS = ["FOLIO_PULLER_PORT", "FOLIO_TARGET_DIR", "FOLIO_DEDUPE_DIR"] as const;
const _savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) _savedEnv[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (_savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = _savedEnv[k];
  }
});

function setEnv(port: string, target: string, dedupe: string): void {
  process.env.FOLIO_PULLER_PORT = port;
  process.env.FOLIO_TARGET_DIR = target;
  process.env.FOLIO_DEDUPE_DIR = dedupe;
}

describe("AC3 / T3.4 — puller reads its port + paths from the exported env", () => {
  it("resolves port, Target and dedupe from env (no hard-coded values)", () => {
    setEnv("9123", "/wt/target", "/wt/dedupe");
    const cfg = loadDevConfig();
    expect(cfg.port).toBe(9123);
    expect(cfg.targetDir).toBe("/wt/target");
    expect(cfg.dedupeDir).toBe("/wt/dedupe");
  });

  it("throws when FOLIO_PULLER_PORT is unset", () => {
    delete process.env.FOLIO_PULLER_PORT;
    setEnv("IGNORED", "/t", "/d"); // sets target/dedupe; port deleted below
    delete process.env.FOLIO_PULLER_PORT;
    expect(() => loadDevConfig()).toThrow(/FOLIO_PULLER_PORT/);
  });

  it("rejects an out-of-range or non-integer port", () => {
    setEnv("99999", "/t", "/d");
    expect(() => loadDevConfig()).toThrow(/valid port/);
    setEnv("not-a-number", "/t", "/d");
    expect(() => loadDevConfig()).toThrow(/valid port/);
  });

  it("throws when the Target/dedupe paths are unset", () => {
    setEnv("8000", "/t", "/d");
    delete process.env.FOLIO_TARGET_DIR;
    expect(() => loadDevConfig()).toThrow(/FOLIO_TARGET_DIR/);
  });
});
