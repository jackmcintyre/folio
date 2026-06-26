/**
 * Hook tests — AC1 for Story 1.2 (`main` made physically uncommittable).
 *
 * Spins up isolated temp git repos and points their core.hooksPath at the
 * committed hooks/ directory, so the real repository's state is never touched.
 * Asserts: a commit on `main` is rejected, a commit on a branch succeeds, and
 * the hook is a versioned, executable, bash-shebang script wired by a single
 * checked-in setup step.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HOOKS_DIR = join(ROOT, "hooks");

const tempRepos: string[] = [];

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "folio-hook-"));
  tempRepos.push(dir);
  // `git init` then force the default branch to `main` (portable across git
  // versions, unlike `git init -b main`).
  git(dir, "init -q");
  git(dir, "symbolic-ref HEAD refs/heads/main");
  git(dir, "config user.email test@folio");
  git(dir, "config user.name test");
  git(dir, "config commit.gpgsign false");
  // Point this throwaway repo at the committed hooks directory.
  git(dir, `config core.hooksPath ${HOOKS_DIR}`);
  return dir;
}

afterEach(() => {
  for (const dir of tempRepos.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("AC1 — the versioned pre-commit hook is in-repo and executable", () => {
  it("ships hooks/pre-commit", () => {
    expect(existsSync(join(HOOKS_DIR, "pre-commit"))).toBe(true);
  });

  it("is executable", () => {
    const mode = statSync(join(HOOKS_DIR, "pre-commit")).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  it("has a bash shebang and resolves HEAD via symbolic-ref", () => {
    const content = readFileSync(join(HOOKS_DIR, "pre-commit"), "utf8");
    expect(content).toMatch(/^#!.*bash/);
    expect(content).toMatch(/symbolic-ref/);
    expect(content).toMatch(/main/);
  });
});

describe("AC1 — the hook is installed by a single checked-in setup step", () => {
  it("root package.json exposes `npm run setup`", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.setup).toBeTruthy();
  });

  it("scripts/setup.sh points git core.hooksPath at the committed hooks dir", () => {
    const setup = readFileSync(join(ROOT, "scripts", "setup.sh"), "utf8");
    expect(setup).toMatch(/core\.hooksPath/);
    expect(setup).toMatch(/hooks/);
  });
});

describe("AC1 — direct commits to main are physically blocked", () => {
  it("rejects a commit while HEAD is on main", () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, "a.txt"), "a");
    git(dir, "add a.txt");

    let caught: unknown;
    try {
      execSync("git commit -m 'on main'", {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      throw new Error("expected the commit on main to be rejected");
    } catch (e) {
      caught = e;
    }

    const err = caught as { status?: number; stderr?: string };
    expect(err.status).toBe(1);
    const stderr = err.stderr ?? "";
    expect(stderr).toMatch(/blocked/i);
    expect(stderr).toContain("'main'");

    // And the commit did NOT land.
    expect(() => git(dir, "log --oneline")).toThrow();
  });

  it("emits a well-formed, accurate recovery message", () => {
    // This test pins the load-bearing elements of the block message so that
    // regressions in its wording are caught (the original `foliERROR` typo and
    // the inaccurate "in-progress commit" wording both slipped past loose
    // /blocked/i matching; this would have failed both).
    const dir = makeTempRepo();
    writeFileSync(join(dir, "a.txt"), "a");
    git(dir, "add a.txt");

    let stderr = "";
    try {
      execSync("git commit -m 'on main'", {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      stderr = (e as { stderr?: string }).stderr ?? "";
    }
    expect(stderr).not.toBe("");

    // Banner prefix is verbatim — guards the `folio: ERROR:` typo class.
    expect(stderr).toContain("folio: ERROR:");
    // ACCURACY: the hook rejects the commit BEFORE it is created, so the
    // recovery must reference *staged changes* (which still exist), not a
    // non-existent "in-progress commit".
    expect(stderr).toMatch(/staged/i);
    // Recovery tells the contributor how to move the work onto a branch.
    expect(stderr).toContain("git switch -c");
    // And points at the workflow docs.
    expect(stderr).toContain("docs/contributing.md");
  });
});

describe("AC1 — commits on a branch still succeed", () => {
  it("allows a commit on a story branch", () => {
    const dir = makeTempRepo();
    git(dir, "checkout -q -b story/bmad-1-2-smoke");
    writeFileSync(join(dir, "b.txt"), "b");
    git(dir, "add b.txt");

    expect(() => git(dir, "commit -m 'on branch'")).not.toThrow();

    const log = git(dir, "log --oneline");
    expect(log).toMatch(/on branch/);
  });

  it("allows a commit in a detached HEAD that is not main", () => {
    const dir = makeTempRepo();
    // Seed an initial commit on a branch so there is a commit to detach from.
    git(dir, "checkout -q -b story/bmad-1-2-seed");
    writeFileSync(join(dir, "s.txt"), "s");
    git(dir, "add s.txt");
    git(dir, "commit -m 'seed'");
    // Detach HEAD at that commit (HEAD is no longer main).
    const head = git(dir, "rev-parse HEAD").trim();
    git(dir, `checkout -q ${head}`);

    writeFileSync(join(dir, "d.txt"), "d");
    git(dir, "add d.txt");
    expect(() => git(dir, "commit -m 'detached'")).not.toThrow();
  });
});

describe("AC1 — hook config is per-worktree (removing a worktree cannot disable main)", () => {
  // Pins the fix for the shared-core.hooksPath footgun: if the setting lived in
  // the shared .git/config as an absolute path, `git worktree remove` of the
  // worktree that owned it would dangle the path and silently disable the hook
  // for every checkout. With `git config --worktree`, each worktree owns its own.
  it("setup.sh scopes core.hooksPath per-worktree", () => {
    const setup = readFileSync(join(ROOT, "scripts", "setup.sh"), "utf8");
    expect(setup).toMatch(/extensions\.worktreeConfig\s+true/);
    expect(setup).toMatch(/git config --worktree core\.hooksPath/);
  });

  it("two worktrees keep independent core.hooksPath values", () => {
    const main = mkdtempSync(join(tmpdir(), "folio-wtcfg-"));
    tempRepos.push(main);
    git(main, "init -q");
    git(main, "symbolic-ref HEAD refs/heads/main");
    git(main, "config user.email t@folio");
    git(main, "config user.name t");
    // Enable per-worktree config (as setup.sh now does).
    git(main, "config extensions.worktreeConfig true");

    // Main repo sets its own (self-referential) hooks path.
    git(main, "config --worktree core.hooksPath /main-hooks");
    expect(git(main, "config --get core.hooksPath").trim()).toBe("/main-hooks");

    // Add a linked worktree and give it its own value.
    const wtPath = main + "-wt";
    git(main, `worktree add -b wt-branch "${wtPath}"`);
    tempRepos.push(wtPath);
    git(wtPath, "config --worktree core.hooksPath /wt-hooks");
    expect(git(wtPath, "config --get core.hooksPath").trim()).toBe("/wt-hooks");

    // Main's value is unchanged by the worktree's own setting.
    expect(git(main, "config --get core.hooksPath").trim()).toBe("/main-hooks");

    // Removing the linked worktree leaves main's value intact (no dangling path).
    git(main, `worktree remove --force "${wtPath}"`);
    expect(git(main, "config --get core.hooksPath").trim()).toBe("/main-hooks");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Story 1.3 AC1 — fast local checks (format) on the pre-commit hook.
//
// Two-tier CI: the LOCAL tier runs only fast checks so it is never fought and
// skipped; the CI tier (comprehensive build/test/secret/CVE/coverage) is a
// separate concern. These tests pin that the hook (a) still blocks main, and
// (b) ALSO runs a fast format check on staged files, while NOT running the
// slow gates locally.
// ────────────────────────────────────────────────────────────────────────────
describe("Story 1.3 AC1 — the pre-commit hook runs only FAST checks", () => {
  it("declares the hook as the fast tier and defers comprehensive checks to CI", () => {
    const content = readFileSync(join(HOOKS_DIR, "pre-commit"), "utf8");
    // The hook must self-document as the FAST local tier (AC1: "complete quickly
    // enough not to be fought").
    expect(content).toMatch(/fast/i);
    // And it must NOT run the slow comprehensive gates itself — those belong to CI.
    // We assert the hook explicitly defers them rather than invoking them.
    expect(content).toMatch(/comprehensive/i);
    expect(content).toMatch(/CI/);
  });

  it("runs a format check on STAGED files only (not the whole tree)", () => {
    const content = readFileSync(join(HOOKS_DIR, "pre-commit"), "utf8");
    // The fast check is scoped to staged files, which is what keeps it fast.
    expect(content).toMatch(/git diff --cached/);
    expect(content).toMatch(/prettier --check/);
  });

  it("does NOT invoke the slow gates (build/test/audit) locally", () => {
    // Belt-and-braces: the local hook must not run tsc/vitest/npm audit — that
    // would make it slow and get fought, defeating the two-tier split.
    const content = readFileSync(join(HOOKS_DIR, "pre-commit"), "utf8");
    // Extract Job 2 (the format block) only; the main-block job is allowed to
    // mention these words in comments. The actual executable format check must
    // be prettier, not a slow gate.
    const job2Start = content.indexOf("Job 2");
    expect(job2Start).toBeGreaterThan(-1);
    const job2 = content.slice(job2Start);
    // No slow-gate invocations in the fast-check section.
    expect(job2).not.toMatch(/\bvitest\b/);
    expect(job2).not.toMatch(/npm\s+audit/);
    expect(job2).not.toMatch(/tsc\s+--noEmit/);
  });

  it("is still executable after the Story 1.3 additions", () => {
    const mode = statSync(join(HOOKS_DIR, "pre-commit")).mode;
    expect(mode & 0o111).not.toBe(0);
  });
});

describe("Story 1.3 AC1 — the format gate is wired and a script exists", () => {
  it("package.json exposes a format:check script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["format:check"]).toMatch(/prettier --check/);
  });

  it("package.json exposes an audit (CVE) script for the CI tier", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["audit"]).toMatch(/npm audit/);
  });
});
