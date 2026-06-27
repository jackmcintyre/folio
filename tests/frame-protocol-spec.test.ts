/**
 * Frame-protocol SPEC tests — AC1 for Story 1.7.
 *
 * AC1: the frame-protocol spec carries an explicit version field; the request
 * frame is `{ v, type, correlationId, idempotencyKey, body }` and the response
 * frame is `{ v, type, correlationId, Receipt | TypedError }`, each with an
 * explicit `type` discriminator and `size` expressed as decoded `byteLen`.
 *
 * These are unit tests over the SPEC (types + version + the canonical codec) in
 * shared/frame-protocol. The cross-side conformance harness is in
 * tests/frame-protocol-conformance.test.ts (AC2).
 */

import { describe, expect, it } from "vitest";
import {
  FRAME_PROTOCOL_VERSION,
  RECEIPT_VERSION,
  ERROR_TOKENS,
  isErrorToken,
  encode,
  decode,
  FrameDecodeError,
} from "../shared/frame-protocol/index.js";
import type { TypedError } from "../shared/frame-protocol/index.js";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const wire = (s: string): Uint8Array => new TextEncoder().encode(s);

// ────────────────────────────────────────────────────────────────────────────
// AC1 — explicit version field.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — the spec carries an explicit version field", () => {
  it("exports FRAME_PROTOCOL_VERSION (a pinned string, not implicit)", () => {
    expect(typeof FRAME_PROTOCOL_VERSION).toBe("string");
    expect(FRAME_PROTOCOL_VERSION).toBe("1");
  });

  it("exports a Receipt version (Receipt is a versioned shape — AD-2)", () => {
    expect(RECEIPT_VERSION).toBe("1");
  });

  it("every encoded frame stamps the version field on the wire", () => {
    const f = {
      v: FRAME_PROTOCOL_VERSION,
      type: "request" as const,
      correlationId: "c",
      idempotencyKey: "k",
      body: utf8("x"),
      size: 1,
    };
    const onWire = JSON.parse(new TextDecoder().decode(encode(f))) as { v: string };
    expect(onWire.v).toBe(FRAME_PROTOCOL_VERSION);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — request frame is { v, type, correlationId, idempotencyKey, body }.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — request frame shape { v, type, correlationId, idempotencyKey, body }", () => {
  it("encodes exactly the request fields (plus size) and nothing else", () => {
    const f = {
      v: FRAME_PROTOCOL_VERSION,
      type: "request" as const,
      correlationId: "corr-1",
      idempotencyKey: "idem-1",
      body: utf8("hello"),
      size: 5,
    };
    const onWire = JSON.parse(new TextDecoder().decode(encode(f))) as Record<string, unknown>;
    // AC1 field set: v, type, correlationId, idempotencyKey, body — plus the
    // size field AC1 also requires ("each ... size expressed as decoded byteLen").
    expect(Object.keys(onWire).sort()).toEqual([
      "body",
      "correlationId",
      "idempotencyKey",
      "size",
      "type",
      "v",
    ]);
  });

  it("carries the body as bytes (base64 on the wire, decoded by the peer)", () => {
    const f = {
      v: FRAME_PROTOCOL_VERSION,
      type: "request" as const,
      correlationId: "c",
      idempotencyKey: "k",
      body: new Uint8Array([0, 1, 2, 254, 255]),
      size: 5,
    };
    const round = decode(encode(f));
    expect(round.type).toBe("request");
    if (round.type === "request") {
      expect(round.body).toBeInstanceOf(Uint8Array);
      expect(Array.from(round.body)).toEqual([0, 1, 2, 254, 255]);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — response frame is { v, type, correlationId, Receipt | TypedError }.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — response frame shape { v, type, correlationId, Receipt | TypedError }", () => {
  const receipt = {
    v: RECEIPT_VERSION,
    path: "inbox",
    filename: "f.md",
    timestamp: "2026-06-23T14:30:00+10:00",
  };
  const resultBytes = utf8(JSON.stringify(receipt)).length;

  it("carries a Receipt in the result position (the success arm)", () => {
    const f = {
      v: FRAME_PROTOCOL_VERSION,
      type: "response" as const,
      correlationId: "c",
      result: receipt,
      size: resultBytes,
    };
    const onWire = JSON.parse(new TextDecoder().decode(encode(f))) as Record<string, unknown>;
    expect(onWire["type"]).toBe("response");
    expect(onWire["result"]).toEqual(receipt);
  });

  it("carries a TypedError in the result position (the failure arm)", () => {
    const err: TypedError = { error: "write_failed", message: "disk full" };
    const f = {
      v: FRAME_PROTOCOL_VERSION,
      type: "response" as const,
      correlationId: "c",
      result: err,
      size: utf8(JSON.stringify(err)).length,
    };
    const round = decode(encode(f));
    if (round.type === "response") {
      expect(round.result).toEqual(err);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — each frame carries an explicit `type` discriminator.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — explicit `type` discriminator on every frame", () => {
  it("stamps type:'request' on request frames and type:'response' on response frames", () => {
    const req = encode({
      v: FRAME_PROTOCOL_VERSION,
      type: "request",
      correlationId: "c",
      idempotencyKey: "k",
      body: utf8("ab"),
      size: 2,
    });
    const res = encode({
      v: FRAME_PROTOCOL_VERSION,
      type: "response",
      correlationId: "c",
      result: { error: "puller_offline" } as TypedError,
      size: utf8(JSON.stringify({ error: "puller_offline" })).length,
    });
    expect((JSON.parse(new TextDecoder().decode(req)) as { type: string }).type).toBe("request");
    expect((JSON.parse(new TextDecoder().decode(res)) as { type: string }).type).toBe("response");
  });

  it("rejects an unknown type discriminator on decode", () => {
    const bogus = wire(JSON.stringify({ v: "1", type: "nope", correlationId: "c", size: 0 }));
    expect(() => decode(bogus)).toThrow(FrameDecodeError);
    expect(() => decode(bogus)).toThrow(/unknown frame type/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — `size` is expressed as decoded byteLen (AD-9: transport/base64 framing
// excluded). Both layers measure the payload bytes.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — size is the decoded byteLen (AD-9)", () => {
  it("request size equals the DECODED body byte length, not the base64 length", () => {
    const body = utf8("hello"); // 5 decoded bytes → base64 "aGVsbG8=" (8 chars)
    const f = {
      v: FRAME_PROTOCOL_VERSION,
      type: "request" as const,
      correlationId: "c",
      idempotencyKey: "k",
      body,
      size: body.byteLength,
    };
    const onWire = JSON.parse(new TextDecoder().decode(encode(f))) as {
      size: number;
      body: string;
    };
    expect(onWire.size).toBe(5); // decoded byteLen, NOT 8 (base64 length)
    expect(onWire.body.length).toBe(8); // the transport/base64 framing
  });

  it("decode REJECTS a request whose declared size != decoded byteLen", () => {
    // body "hello" decodes to 5 bytes; declare size 99.
    const bad = wire(
      JSON.stringify({
        v: "1",
        type: "request",
        correlationId: "c",
        idempotencyKey: "k",
        size: 99,
        body: "aGVsbG8=",
      }),
    );
    expect(() => decode(bad)).toThrow(FrameDecodeError);
    expect(() => decode(bad)).toThrow(/request size mismatch/i);
  });

  it("response size equals the decoded byteLen of the canonical result JSON", () => {
    const result: TypedError = { error: "rate_limited" };
    const f = {
      v: FRAME_PROTOCOL_VERSION,
      type: "response" as const,
      correlationId: "c",
      result,
      size: utf8(JSON.stringify(result)).length,
    };
    const onWire = JSON.parse(new TextDecoder().decode(encode(f))) as { size: number };
    expect(onWire.size).toBe(utf8(JSON.stringify(result)).length);
  });

  it("decode REJECTS a response whose declared size != decoded result byteLen", () => {
    const bad = wire(
      JSON.stringify({
        v: "1",
        type: "response",
        correlationId: "c",
        size: 999,
        result: { error: "rate_limited" },
      }),
    );
    expect(() => decode(bad)).toThrow(FrameDecodeError);
    expect(() => decode(bad)).toThrow(/response size mismatch/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AD-8 — the typed-error token set is pinned (carried by the response frame).
// ────────────────────────────────────────────────────────────────────────────
describe("AD-8 — the response frame's error token set is pinned", () => {
  it("exports exactly the 8 canonical tokens (incl. idempotency_conflict)", () => {
    expect([...ERROR_TOKENS]).toEqual([
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

  it("isErrorToken accepts a pinned token and rejects anything else", () => {
    expect(isErrorToken("write_failed")).toBe(true);
    expect(isErrorToken("idempotency_conflict")).toBe(true);
    expect(isErrorToken("not-a-token")).toBe(false);
    expect(isErrorToken(undefined)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — version guard: a frame with the wrong version is rejected.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — version mismatch is rejected", () => {
  it("decode throws on a frame whose v != FRAME_PROTOCOL_VERSION", () => {
    const bad = wire(
      JSON.stringify({
        v: "2",
        type: "request",
        correlationId: "c",
        idempotencyKey: "k",
        size: 5,
        body: "aGVsbG8=",
      }),
    );
    expect(() => decode(bad)).toThrow(FrameDecodeError);
    expect(() => decode(bad)).toThrow(/frame version mismatch/i);
  });
});
