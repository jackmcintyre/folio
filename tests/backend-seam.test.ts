/**
 * Backend-seam tests — AC1 + AC2 for Story 1.6 (Backend port and stub Backend
 * with seam test).
 *
 * This is the SWAPPABILITY PROOF (FR-18 / AR-4): a stub Backend is registered
 * behind the `deliver(payload, idempotencyKey)` port and the tool handler drives
 * a real Filing through it. The Filing completes via the stub — with no change to
 * the published `file` schema, the auth model, or the handler — and the stub is
 * shown to return BOTH a contract-valid Receipt AND each of the canonical eight
 * typed errors. That is the product's core bet (a hosted Backend can replace the
 * v1 Relay Backend behind the same seam) made provable before the real Backend
 * exists.
 *
 * AC1 (handler delivers only via the port) is enforced primarily by the AD-1
 * lint (tests/lint.test.ts, folio/handler-layering). Here we corroborate it from
 * the runtime side: the handler reaches the world ONLY through the port (with no
 * Backend registered it cannot deliver), and its source imports neither the
 * transport adapter nor the filesystem.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  FILE_CONTRACT_VERSION,
  FILE_INPUT_REQUIRED_FIELDS,
  TYPED_ERROR_TOKENS,
  parseReceipt,
  parseTypedError,
  validateFileInput,
  type Receipt,
  type TypedError,
  type TypedErrorToken,
} from "../shared/file-contract/index.js";
import {
  deliver,
  registerBackend,
  resetBackend,
  type Backend,
  type DeliverPayload,
  type DeliverResult,
} from "../relay/src/backend/index.js";
import { handleFile } from "../relay/src/handler/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

// A contract-valid Filing request, expressed purely in the published `file`
// vocabulary — exactly what a generic MCP client would send.
const VALID_INPUT = {
  content: "the body to file",
  slug: "my-note",
  extension: "md",
  idempotencyKey: "idem-key-test-fixture-0001", // not a secret, just a fixture key matching the grammar (>=16 chars) gitleaks:allow
} as const;

// A contract-valid Receipt the stub can mint (pinned shape, version, +offset ts).
const STUB_RECEIPT: Receipt = {
  v: FILE_CONTRACT_VERSION,
  path: "notes/2026/06",
  filename: "2026-06-27-143000-my-note.md",
  timestamp: "2026-06-27T14:30:00+10:00",
};

/**
 * A stub Backend registered behind the port. It records what it was handed (so
 * the test can assert the handler forwarded the payload + key faithfully) and
 * returns whatever outcome it was configured with — a Receipt or any typed error.
 */
class StubBackend implements Backend {
  public lastPayload: DeliverPayload | undefined;
  public lastKey: string | undefined;
  public calls = 0;

  constructor(private readonly outcome: DeliverResult) {}

  deliver(payload: DeliverPayload, idempotencyKey: string): Promise<DeliverResult> {
    this.calls += 1;
    this.lastPayload = payload;
    this.lastKey = idempotencyKey;
    return Promise.resolve(this.outcome);
  }
}

/** Build the typed-error outcome for one canonical token. */
function errorOutcome(token: TypedErrorToken): TypedError {
  return { error: token, message: `stub backend returned ${token}` };
}

// The port is a module-level singleton; restore the unwired state after each
// test so no registration leaks between cases.
afterEach(() => {
  resetBackend();
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — a stub Backend registered behind the port completes a Filing.
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — a Filing completes through a stub Backend registered behind the port", () => {
  it("drives a Filing through the stub and returns a contract-valid Receipt", async () => {
    const stub = new StubBackend(STUB_RECEIPT);
    registerBackend(stub);

    const result = await handleFile(VALID_INPUT);

    // The Filing completed through the stub (the handler reached it via deliver).
    expect(stub.calls).toBe(1);
    // The Receipt the handler returned is contract-valid (parsed by the generic
    // contract parser, not by any Folio internal).
    const parsed = parseReceipt(result);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(STUB_RECEIPT);
    }
  });

  it("forwards the payload and idempotency key to the Backend faithfully", async () => {
    const stub = new StubBackend(STUB_RECEIPT);
    registerBackend(stub);

    await handleFile(VALID_INPUT);

    // The idempotency key travels as the SEPARATE port argument (AD-5/AD-19), not
    // inside the payload body.
    expect(stub.lastKey).toBe(VALID_INPUT.idempotencyKey);
    expect(stub.lastPayload).toEqual({
      content: VALID_INPUT.content,
      slug: VALID_INPUT.slug,
      extension: VALID_INPUT.extension,
    });
    expect(stub.lastPayload).not.toHaveProperty("idempotencyKey");
  });

  it("can be made to return EACH of the canonical eight typed errors", async () => {
    // The whole pinned token set, exercised end-to-end through the port. Each
    // token survives the hop unchanged and parses as a contract-valid TypedError.
    expect(TYPED_ERROR_TOKENS.length).toBe(8);
    for (const token of TYPED_ERROR_TOKENS) {
      const stub = new StubBackend(errorOutcome(token));
      registerBackend(stub);

      const result = await handleFile(VALID_INPUT);

      const parsed = parseTypedError(result);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        // The token propagated across the seam unchanged (AD-8).
        expect(parsed.value.error).toBe(token);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — completing through the stub requires NO change to the file schema, the
// auth model, or the handler (the swappability invariant).
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — swapping in the stub Backend touches neither schema, auth, nor handler", () => {
  it("the published `file` schema is unchanged: the same input still validates", () => {
    // The Filing was constructed from ONLY the published contract; validating it
    // against the published schema proves the seam needed no schema change.
    expect(validateFileInput(VALID_INPUT).ok).toBe(true);
    expect([...FILE_INPUT_REQUIRED_FIELDS]).toEqual([
      "content",
      "slug",
      "extension",
      "idempotencyKey",
    ]);
  });

  it("the auth model is untouched: relay/src/auth remains an unwired placeholder", () => {
    // The seam registers a Backend without going near auth; auth stays the
    // placeholder it was before this story.
    const authSrc = readFileSync(resolve(ROOT, "relay/src/auth/index.ts"), "utf8");
    expect(authSrc).toContain("Placeholder: implementation is the subject of a later story");
    expect(authSrc).toContain("export default {}");
  });

  it("the handler is unchanged across a Backend swap: one code path drives both", async () => {
    // Register a Receipt-returning Backend, then swap to an error-returning one.
    // The SAME handleFile drives both outcomes — swapping the Backend required no
    // handler change, which is the swappability bet.
    const happy = new StubBackend(STUB_RECEIPT);
    registerBackend(happy);
    const first = await handleFile(VALID_INPUT);
    expect(parseReceipt(first).ok).toBe(true);

    const sad = new StubBackend(errorOutcome("puller_offline"));
    registerBackend(sad);
    const second = await handleFile(VALID_INPUT);
    const parsedSecond = parseTypedError(second);
    expect(parsedSecond.ok).toBe(true);
    if (parsedSecond.ok) {
      expect(parsedSecond.value.error).toBe("puller_offline");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — the handler delivers content ONLY through deliver() (runtime side of the
// AD-1 layering law the lint enforces statically).
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — the handler reaches the world only through the Backend port", () => {
  it("cannot deliver with no Backend registered (it has no other path out)", async () => {
    // With the port unwired, a valid Filing cannot complete: the handler has no
    // transport or filesystem path to fall back on — its only exit is deliver().
    resetBackend();
    await expect(handleFile(VALID_INPUT)).rejects.toThrow(/no Backend registered/);
  });

  it("rejects a contract-invalid request BEFORE touching the port", async () => {
    // A request missing the idempotency key fails contract validation and is
    // returned as `invalid_path`; the Backend is never called.
    const stub = new StubBackend(STUB_RECEIPT);
    registerBackend(stub);

    const { idempotencyKey: _omitted, ...withoutKey } = VALID_INPUT;
    const result = await handleFile(withoutKey);

    const parsed = parseTypedError(result);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.error).toBe("invalid_path");
    }
    expect(stub.calls).toBe(0);
  });

  it("the handler source imports neither the transport adapter nor the filesystem", () => {
    // Belt-and-braces with folio/handler-layering: read the handler source and
    // assert it carries no transport or fs import (the only forbidden edges).
    const handlerSrc = readFileSync(resolve(ROOT, "relay/src/handler/index.ts"), "utf8");
    expect(handlerSrc).not.toMatch(/from\s+["'][^"']*\/transport\//);
    expect(handlerSrc).not.toMatch(/from\s+["']node:fs(\/promises)?["']/);
    expect(handlerSrc).not.toMatch(/from\s+["']fs(\/promises)?["']/);
    // And it DOES reach the world through the Backend port.
    expect(handlerSrc).toMatch(/from\s+["']\.\.\/backend\/index\.js["']/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Port plumbing — the module-level `deliver` export delegates to the registered
// Backend and fails loudly when unwired.
// ────────────────────────────────────────────────────────────────────────────
describe("Backend port — registration + delegation plumbing", () => {
  it("deliver() throws when no Backend is registered", () => {
    resetBackend();
    expect(() =>
      deliver({ content: "x", slug: "s", extension: "md" }, "idem-key-test-fixture-0001"),
    ).toThrow(/no Backend registered/);
  });

  it("deliver() delegates to the most recently registered Backend", async () => {
    const stub = new StubBackend(STUB_RECEIPT);
    registerBackend(stub);
    const result = await deliver(
      { content: "x", slug: "s", extension: "md" },
      "idem-key-test-fixture-0001",
    );
    expect(stub.calls).toBe(1);
    expect(result).toEqual(STUB_RECEIPT);
  });
});
