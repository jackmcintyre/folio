/**
 * Tracing tests — Story 1.8 AC6/AC3 (tracing primitive: no body content at rest).
 *
 * The tracing primitive records action + derivedPath + outcome token BY
 * CONSTRUCTION. These tests prove:
 *  - the record carries exactly those four fields (compile-time + runtime);
 *  - body content or fragments cannot enter the record by any field;
 *  - the "no body at rest" invariant holds on the serialised form.
 *
 * FR-15, AD-12, AD-21.
 */

import { describe, it, expect } from "vitest";
import {
  trace,
  TraceFieldError,
  OUTCOME_TOKENS,
  type TraceRecord,
  type OutcomeToken,
} from "../shared/observability/index.js";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time proof: TraceRecord has EXACTLY the four permitted keys.
// If anyone adds a body/content/payload field to TraceRecord, `ExactlyFour`
// resolves to `never` and the assignment below stops compiling — failing the
// build gate. This is the "by construction" guarantee made machine-checked.
// ────────────────────────────────────────────────────────────────────────────
type ExactlyFour = keyof TraceRecord extends "action" | "correlationId" | "derivedPath" | "outcome"
  ? "action" | "correlationId" | "derivedPath" | "outcome" extends keyof TraceRecord
    ? true
    : never
  : never;
const _comptimeProofExactlyFourKeys: ExactlyFour = true;

// No forbidden field is a member of TraceRecord's key set.
type ForbiddenField = Extract<
  keyof TraceRecord,
  "body" | "content" | "payload" | "fragment" | "data" | "text" | "bytes"
>;
const _comptimeProofNoForbidden: ForbiddenField[] = []; // never[] when clean

// ────────────────────────────────────────────────────────────────────────────
describe("AC3 — trace records action, derived path, and outcome by construction", () => {
  it("mints a record with exactly the four permitted fields", () => {
    const rec = trace({
      action: "file.filing",
      correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
      derivedPath: "inbox/2026-06-27-120000-note.md",
      outcome: "success",
    });
    expect(Object.keys(rec).sort()).toEqual(
      ["action", "correlationId", "derivedPath", "outcome"].sort(),
    );
    expect(rec.action).toBe("file.filing");
    expect(rec.derivedPath).toBe("inbox/2026-06-27-120000-note.md");
    expect(rec.outcome).toBe("success");
  });

  it("records every outcome token in the AD-8 set", () => {
    for (const outcome of OUTCOME_TOKENS) {
      const rec = trace({
        action: "file.filing",
        correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
        derivedPath: "inbox/x",
        outcome: outcome as OutcomeToken,
      });
      expect(rec.outcome).toBe(outcome);
    }
  });

  it("the record is frozen (immutable at rest)", () => {
    const rec = trace({
      action: "file.filing",
      correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
      derivedPath: "inbox/x",
      outcome: "success",
    });
    expect(Object.isFrozen(rec)).toBe(true);
    expect(() => {
      // Cast to a mutable shape so the assignment compiles; Object.freeze makes
      // it throw at runtime — that is the at-rest immutability guarantee.
      (rec as { outcome: string }).outcome = "write_failed";
    }).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("AC3 — no body content or fragment can be written to a trace at rest", () => {
  it("a stray `body` key on the input is dropped, never retained", () => {
    // A structurally-typed caller cannot smuggle body through excess typing.
    const smuggle = {
      action: "file.filing",
      correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
      derivedPath: "inbox/x",
      outcome: "success" as OutcomeToken,
      body: "TOP SECRET BODY CONTENT",
      content: "fragment-of-body",
    };
    const rec = trace(smuggle);
    expect(Object.keys(rec)).not.toContain("body");
    expect(Object.keys(rec)).not.toContain("content");
    const serialised = JSON.stringify(rec);
    expect(serialised).not.toContain("TOP SECRET BODY CONTENT");
    expect(serialised).not.toContain("fragment-of-body");
  });

  it("the serialised record carries no body-ish key name", () => {
    const rec = trace({
      action: "file.filing",
      correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
      derivedPath: "inbox/x",
      outcome: "integrity_failed",
    });
    const serialised = JSON.stringify(rec);
    for (const forbidden of ["body", "content", "payload", "fragment", "data", "text", "bytes"]) {
      expect(serialised).not.toMatch(new RegExp(`"${forbidden}"`));
    }
  });

  it("rejects body content smuggled through derivedPath as a newline", () => {
    expect(() =>
      trace({
        action: "file.filing",
        correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
        derivedPath: "inbox/x\nline-two-body-content",
        outcome: "success",
      }),
    ).toThrow(TraceFieldError);
  });

  it("rejects body content smuggled through derivedPath as a control byte", () => {
    expect(() =>
      trace({
        action: "file.filing",
        correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
        derivedPath: "inbox/x\x00tab\tbody",
        outcome: "success",
      }),
    ).toThrow(TraceFieldError);
  });

  it("rejects a derivedPath long enough to be body content", () => {
    expect(() =>
      trace({
        action: "file.filing",
        correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
        derivedPath: "a".repeat(600),
        outcome: "success",
      }),
    ).toThrow(TraceFieldError);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("AC3 — every field is validated", () => {
  const ok = {
    action: "file.filing",
    correlationId: "01H7Z8X9G0ABCDEFG0ABCDEFG",
    derivedPath: "inbox/x",
    outcome: "success" as OutcomeToken,
  };

  it("rejects an unknown outcome token (prose cannot pose as a token)", () => {
    expect(() =>
      trace({ ...ok, outcome: "everything was fine, body was: hello" as OutcomeToken }),
    ).toThrow(TraceFieldError);
  });

  it("rejects a non-identifier action (e.g. a sentence)", () => {
    expect(() => trace({ ...ok, action: "not an action, body=hello" })).toThrow(TraceFieldError);
  });

  it("rejects a non-identifier correlationId", () => {
    expect(() => trace({ ...ok, correlationId: "has spaces in it" })).toThrow(TraceFieldError);
  });

  it("rejects an over-long action", () => {
    expect(() => trace({ ...ok, action: "a".repeat(65) })).toThrow(TraceFieldError);
  });

  it("rejects an empty derivedPath", () => {
    expect(() => trace({ ...ok, derivedPath: "" })).toThrow(TraceFieldError);
  });
});
