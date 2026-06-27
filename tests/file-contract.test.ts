/**
 * file-contract tests — AC1–AC4 for Story 1.5 (Pinned, versioned `file` contract).
 *
 * This is the CONTRACT TEST (FR-3): it pins the `file` input/output schema
 * shape, the Receipt, and the typed-error token set from the perspective of a
 * GENERIC MCP client that knows only the published schema. An incompatible
 * change to any pinned shape fails this test in CI (AC3).
 *
 * It imports ONLY the published contract surface from shared/file-contract — no
 * relay/puller internals, no Claude/KB knowledge — which is itself the proof for
 * AC4 (a generic client can construct a valid request and parse every result).
 */

import { describe, expect, it } from "vitest";
import {
  FILE_CONTRACT_VERSION,
  FILE_INPUT_SCHEMA,
  FILE_INPUT_REQUIRED_FIELDS,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_PATTERN,
  RECEIPT_KEYS,
  RECEIPT_TIMESTAMP_PATTERN,
  TYPED_ERROR_TOKENS,
  TYPED_ERROR_TOKEN_SET,
  parseReceipt,
  parseTypedError,
  validateFileInput,
} from "../shared/file-contract/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — version field; Receipt pinned shape; canonical eight typed-error tokens.
// ─────────────────────────────────────────────────────────────────────────────
describe("AC1 — contract carries a version field", () => {
  it("FILE_CONTRACT_VERSION is an explicit, non-empty string identifier", () => {
    expect(typeof FILE_CONTRACT_VERSION).toBe("string");
    expect(FILE_CONTRACT_VERSION.length).toBeGreaterThan(0);
    expect(/^\d+$/.test(FILE_CONTRACT_VERSION)).toBe(true); // single-integer pin
  });

  it("the published input schema carries the same version", () => {
    expect(FILE_INPUT_SCHEMA.v).toBe(FILE_CONTRACT_VERSION);
  });
});

describe("AC1 — Receipt is the pinned shape { v, path, filename, timestamp }", () => {
  it("RECEIPT_KEYS is exactly the four pinned keys in order", () => {
    expect([...RECEIPT_KEYS]).toEqual(["v", "path", "filename", "timestamp"]);
  });

  it("a valid Receipt parses (v + relative path + ISO-8601-with-offset timestamp)", () => {
    const receipt = {
      v: FILE_CONTRACT_VERSION,
      path: "notes/2026/06",
      filename: "2026-06-27T14-30-00-summary.md",
      timestamp: "2026-06-27T14:30:00+10:00",
    };
    const result = parseReceipt(receipt);
    expect(result.ok).toBe(true);
  });

  it("rejects a Receipt with an unknown extra key (shape change is loud)", () => {
    const result = parseReceipt({
      v: FILE_CONTRACT_VERSION,
      path: "notes",
      filename: "f.md",
      timestamp: "2026-06-27T14:30:00+10:00",
      extra: "nope",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an absolute path (path is relative to the Target directory)", () => {
    const result = parseReceipt({
      v: FILE_CONTRACT_VERSION,
      path: "/abs/path",
      filename: "f.md",
      timestamp: "2026-06-27T14:30:00+10:00",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a timestamp without a numeric offset (e.g. a bare Z)", () => {
    const result = parseReceipt({
      v: FILE_CONTRACT_VERSION,
      path: "notes",
      filename: "f.md",
      timestamp: "2026-06-27T14:30:00Z",
    });
    expect(result.ok).toBe(false);
  });

  it("RECEIPT_TIMESTAMP_PATTERN matches ISO-8601 with a numeric offset", () => {
    expect(RECEIPT_TIMESTAMP_PATTERN.test("2026-06-27T14:30:00+10:00")).toBe(true);
    expect(RECEIPT_TIMESTAMP_PATTERN.test("2026-06-27T14:30:00.123-05:00")).toBe(true);
    expect(RECEIPT_TIMESTAMP_PATTERN.test("2026-06-27T14:30:00Z")).toBe(false);
  });
});

describe("AC1 — typed-error set is the canonical EIGHT tokens", () => {
  const EXPECTED_EIGHT = [
    "unauthorized",
    "puller_offline",
    "payload_too_large",
    "rate_limited",
    "invalid_path",
    "integrity_failed",
    "write_failed",
    "idempotency_conflict",
  ];

  it("TYPED_ERROR_TOKENS is exactly the canonical eight (no more, no less, exact set)", () => {
    expect([...TYPED_ERROR_TOKENS].sort()).toEqual([...EXPECTED_EIGHT].sort());
    expect(TYPED_ERROR_TOKENS).toHaveLength(8);
  });

  it("every token is unique", () => {
    expect(new Set(TYPED_ERROR_TOKENS).size).toBe(TYPED_ERROR_TOKENS.length);
  });

  it("the 8th token is idempotency_conflict (the architecture extension to PRD §3)", () => {
    expect(TYPED_ERROR_TOKEN_SET.has("idempotency_conflict")).toBe(true);
  });

  it("a non-canonical token is not a member (regression guard)", () => {
    expect(TYPED_ERROR_TOKEN_SET.has("generic_error" as never)).toBe(false);
    expect(TYPED_ERROR_TOKEN_SET.has("unknown" as never)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — required idempotency key with pinned grammar; missing key is invalid.
// ─────────────────────────────────────────────────────────────────────────────
describe("AC2 — input schema has a REQUIRED idempotency key with a pinned grammar", () => {
  it("idempotencyKey is a required field", () => {
    expect(FILE_INPUT_REQUIRED_FIELDS).toContain("idempotencyKey");
    const spec = FILE_INPUT_SCHEMA.fields.find((f) => f.name === "idempotencyKey");
    expect(spec?.required).toBe(true);
  });

  it("the grammar is pinned (URL-safe, length-bounded, no path separators)", () => {
    const spec = FILE_INPUT_SCHEMA.fields.find((f) => f.name === "idempotencyKey");
    expect(spec?.pattern).toBe(IDEMPOTENCY_KEY_PATTERN.source);
    expect(spec?.minLength).toBe(IDEMPOTENCY_KEY_MIN_LENGTH);
    expect(spec?.maxLength).toBe(IDEMPOTENCY_KEY_MAX_LENGTH);
    expect(IDEMPOTENCY_KEY_MIN_LENGTH).toBe(16);
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(128);
  });

  it("the grammar rejects path separators / traversal characters", () => {
    // No '/', '\', '.', or NUL — prevents raw-key-as-store-path traversal (AD-19).
    expect(IDEMPOTENCY_KEY_PATTERN.test("good-key-1234567")).toBe(true); // 16 chars, OK
    expect(IDEMPOTENCY_KEY_PATTERN.test("bad/key1234567890")).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test("bad.key1234567890")).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test("bad\\key1234567890")).toBe(false);
  });

  it("the grammar rejects too-short and too-long keys", () => {
    expect(IDEMPOTENCY_KEY_PATTERN.test("short")).toBe(false); // < 16
    expect(IDEMPOTENCY_KEY_PATTERN.test("x".repeat(15))).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test("x".repeat(16))).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test("x".repeat(128))).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test("x".repeat(129))).toBe(false);
  });
});

describe("AC2 — a call MISSING the idempotency key is invalid against the schema", () => {
  it("rejects a request with no idempotencyKey", () => {
    const result = validateFileInput({ content: "body", slug: "summary", extension: "md" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("idempotencyKey"))).toBe(true);
    }
  });

  it("rejects a request with a null/undefined idempotencyKey", () => {
    expect(
      validateFileInput({ content: "b", slug: "s", extension: "md", idempotencyKey: null }).ok,
    ).toBe(false);
    expect(
      validateFileInput({ content: "b", slug: "s", extension: "md", idempotencyKey: undefined }).ok,
    ).toBe(false);
  });

  it("rejects a request with a malformed idempotencyKey", () => {
    const result = validateFileInput({
      content: "body",
      slug: "summary",
      extension: "md",
      idempotencyKey: "has spaces and / traversal",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a fully valid request (content + slug + extension + valid key)", () => {
    const result = validateFileInput({
      content: "the text body",
      slug: "summary",
      extension: "md",
      idempotencyKey: "01H8KX8Z0Z0Z0Z0Z0Z0Z0Z0Z0X", // ULID-like, 26 chars
    });
    expect(result.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3 (integration) — the contract test fails in CI on an incompatible shape
// change. The assertions in THIS file ARE the pin: rename a key, drop a token,
// reshape the Receipt, and one of the assertions above/below breaks. The block
// below pins the field names and token set as exact literals so a silent drift
// cannot pass.
// ─────────────────────────────────────────────────────────────────────────────
describe("AC3 — incompatible shape change fails CI (exact-shape pins)", () => {
  it("input field names are exactly { content, slug, extension, idempotencyKey }", () => {
    expect(FILE_INPUT_SCHEMA.fields.map((f) => f.name)).toEqual([
      "content",
      "slug",
      "extension",
      "idempotencyKey",
    ]);
  });

  it("every input field is required (FR-1 minimum set + idempotency key)", () => {
    expect(FILE_INPUT_SCHEMA.fields.every((f) => f.required)).toBe(true);
    expect(FILE_INPUT_REQUIRED_FIELDS).toEqual(["content", "slug", "extension", "idempotencyKey"]);
  });

  it("the Receipt key set is pinned as a literal (rename breaks this)", () => {
    expect([...RECEIPT_KEYS]).toEqual(["v", "path", "filename", "timestamp"]);
  });

  it("the typed-error token set is pinned as a literal (add/remove breaks this)", () => {
    // Snapshot-style exact pin: order is the canonical order from AD-8.
    expect([...TYPED_ERROR_TOKENS]).toEqual([
      "unauthorized",
      "puller_offline",
      "payload_too_large",
      "rate_limited",
      "invalid_path",
      "integrity_failed",
      "write_failed",
      "idempotency_conflict",
    ]);
  });

  it("the input schema advertises exactly one tool named 'file'", () => {
    expect(FILE_INPUT_SCHEMA.tool).toBe("file");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4 — a generic (non-Claude) MCP client, using ONLY the published schema, can
// construct a valid `file` request and parse a Receipt and EACH typed error
// without any Claude- or KB-specific knowledge. (This whole file imports only
// the published contract surface — no relay/puller internals — which IS the
// generic-client posture.)
// ─────────────────────────────────────────────────────────────────────────────
describe("AC4 — generic client builds a request and parses every result", () => {
  it("constructs a valid request from only the published schema descriptor", () => {
    // A generic client reads FILE_INPUT_SCHEMA to know what to send.
    const request: Record<string, string> = {};
    for (const field of FILE_INPUT_SCHEMA.fields) {
      // It supplies a value for every required field.
      switch (field.name) {
        case "content":
          request[field.name] = "a synthesised piece of text";
          break;
        case "slug":
          request[field.name] = "summary";
          break;
        case "extension":
          request[field.name] = "md";
          break;
        case "idempotencyKey":
          // Generated per the contract doc (README §idempotency key).
          request[field.name] = "01KW3EWXZ8G2DGRMXWPHBW3CT1"; // ULID, 26 chars
          break;
      }
    }
    expect(validateFileInput(request).ok).toBe(true);
  });

  it("parses a Receipt returned by the tool", () => {
    const result = parseReceipt({
      v: FILE_CONTRACT_VERSION,
      path: "inbox",
      filename: "2026-06-27T14-30-00-summary.md",
      timestamp: "2026-06-27T14:30:00+10:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe("inbox");
      expect(result.value.v).toBe(FILE_CONTRACT_VERSION);
    }
  });

  it("parses EACH of the eight typed errors (none require Claude/KB knowledge)", () => {
    for (const token of TYPED_ERROR_TOKENS) {
      const result = parseTypedError({ error: token, message: `failure: ${token}` });
      expect(result.ok, `token ${token} should parse`).toBe(true);
      if (result.ok) {
        expect(result.value.error).toBe(token);
      }
    }
  });

  it("rejects a typed error carrying an out-of-set token", () => {
    expect(parseTypedError({ error: "something_else", message: "x" }).ok).toBe(false);
  });
});
