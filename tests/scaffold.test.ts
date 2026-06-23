/**
 * Scaffold tests — Story 1.1 (AC1 + AC2)
 *
 * AC1: The source tree matches the architecture, runtime pins are correct,
 *      load-bearing deps are exact-pinned, and lockfiles are present.
 *
 * AC2: A frozen install in each workspace succeeds with no network drift
 *      and no lockfile mutation.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import toml from "@iarna/toml";

const ROOT = path.resolve(import.meta.dirname, "..");

function rootPath(...parts: string[]): string {
  return path.join(ROOT, ...parts);
}

function exists(rel: string): boolean {
  return fs.existsSync(rootPath(rel));
}

// ── AC1: Source tree structure ─────────────────────────────────────────────

describe("AC1 — source tree matches architecture", () => {
  const requiredDirs = [
    "relay/src/transport",
    "relay/src/auth",
    "relay/src/handler",
    "relay/src/backend",
    "relay/src/broker",
    "puller/src/channel",
    "puller/src/write",
    "puller/src/dedupe",
    "puller/src/limits",
    "shared/frame-protocol",
    "docs",
  ];

  for (const dir of requiredDirs) {
    it(`directory exists: ${dir}`, () => {
      expect(exists(dir)).toBe(true);
    });
  }
});

// ── AC1: Worker runtime pins (wrangler.toml) ───────────────────────────────

describe("AC1 — Worker runtime pinned (wrangler.toml)", () => {
  let wrangler: Record<string, unknown>;

  beforeAll(() => {
    const raw = fs.readFileSync(rootPath("relay/wrangler.toml"), "utf8");
    wrangler = toml.parse(raw) as Record<string, unknown>;
  });

  it("compatibility_date is 2026-06-23", () => {
    expect(wrangler["compatibility_date"]).toBe("2026-06-23");
  });

  it("compatibility_flags includes nodejs_compat", () => {
    expect(wrangler["compatibility_flags"]).toContain("nodejs_compat");
  });
});

// ── AC1: Node 24 LTS pin (puller/package.json) ─────────────────────────────

describe("AC1 — Puller pins Node 24 LTS", () => {
  let pullerPkg: Record<string, unknown>;

  beforeAll(() => {
    pullerPkg = JSON.parse(
      fs.readFileSync(rootPath("puller/package.json"), "utf8"),
    ) as Record<string, unknown>;
  });

  it("engines.node constrains to Node 24", () => {
    const engines = pullerPkg["engines"] as Record<string, string> | undefined;
    expect(engines).toBeDefined();
    // Accept "^24", "24.x", ">=24 <25", etc. — must start with or contain 24.
    expect(engines!["node"]).toMatch(/24/);
  });
});

// ── AC1: Load-bearing dep exact pins ──────────────────────────────────────

describe("AC1 — load-bearing deps are exact-pinned (relay/package.json)", () => {
  let relayPkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  beforeAll(() => {
    relayPkg = JSON.parse(
      fs.readFileSync(rootPath("relay/package.json"), "utf8"),
    ) as typeof relayPkg;
  });

  function dep(name: string): string | undefined {
    return (
      relayPkg.dependencies?.[name] ?? relayPkg.devDependencies?.[name]
    );
  }

  it("agents is exact-pinned to 0.16.x (no range prefix)", () => {
    const v = dep("agents");
    expect(v).toBeDefined();
    expect(v).toMatch(/^0\.16\./);
    // Must not start with ^ or ~
    expect(v).not.toMatch(/^[\^~]/);
  });

  it("@cloudflare/workers-oauth-provider is exact-pinned to 0.8.x", () => {
    const v = dep("@cloudflare/workers-oauth-provider");
    expect(v).toBeDefined();
    expect(v).toMatch(/^0\.8\./);
    expect(v).not.toMatch(/^[\^~]/);
  });

  it("@modelcontextprotocol/sdk is on ^1.29", () => {
    const v = dep("@modelcontextprotocol/sdk");
    expect(v).toBeDefined();
    expect(v).toMatch(/^\^1\.29/);
  });

  it("TypeScript is exact-pinned to 5.x (no range prefix)", () => {
    const v = dep("typescript");
    expect(v).toBeDefined();
    expect(v).toMatch(/^5\./);
    expect(v).not.toMatch(/^[\^~]/);
  });
});

describe("AC1 — ws is exact-pinned 8.21.0 (puller/package.json)", () => {
  let pullerPkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  beforeAll(() => {
    pullerPkg = JSON.parse(
      fs.readFileSync(rootPath("puller/package.json"), "utf8"),
    ) as typeof pullerPkg;
  });

  it("ws is exact-pinned to 8.21.0", () => {
    const v =
      pullerPkg.dependencies?.["ws"] ?? pullerPkg.devDependencies?.["ws"];
    expect(v).toBeDefined();
    expect(v).toBe("8.21.0");
  });

  it("typescript is exact-pinned to 5.x in puller devDependencies", () => {
    const v = pullerPkg.devDependencies?.["typescript"];
    expect(v).toBeDefined();
    expect(v).toMatch(/^5\./);
    expect(v).not.toMatch(/^[\^~]/);
  });
});

// ── AC1: Lockfiles committed ───────────────────────────────────────────────

describe("AC1 — lockfiles are committed", () => {
  it("relay/package-lock.json exists", () => {
    expect(exists("relay/package-lock.json")).toBe(true);
  });

  it("puller/package-lock.json exists", () => {
    expect(exists("puller/package-lock.json")).toBe(true);
  });
});

// ── AC2: Frozen install succeeds with no lockfile mutation ────────────────

describe("AC2 — frozen install in each workspace succeeds", () => {
  it(
    "relay: npm ci completes and does not mutate the lockfile",
    () => {
      const lockBefore = fs.readFileSync(
        rootPath("relay/package-lock.json"),
        "utf8",
      );
      execSync("npm ci", {
        cwd: rootPath("relay"),
        stdio: "pipe",
        timeout: 120_000,
      });
      const lockAfter = fs.readFileSync(
        rootPath("relay/package-lock.json"),
        "utf8",
      );
      expect(lockAfter).toBe(lockBefore);
    },
    130_000,
  );

  it(
    "puller: npm ci completes and does not mutate the lockfile",
    () => {
      const lockBefore = fs.readFileSync(
        rootPath("puller/package-lock.json"),
        "utf8",
      );
      execSync("npm ci", {
        cwd: rootPath("puller"),
        stdio: "pipe",
        timeout: 120_000,
      });
      const lockAfter = fs.readFileSync(
        rootPath("puller/package-lock.json"),
        "utf8",
      );
      expect(lockAfter).toBe(lockBefore);
    },
    130_000,
  );
});
