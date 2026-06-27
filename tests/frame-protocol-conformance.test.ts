/**
 * Frame-protocol CONFORMANCE tests — AC2 (integration) for Story 1.7.
 *
 * AC2: the shared conformance vectors are asserted against BOTH a relay-side
 * and a puller-side encoder/decoder (stubs acceptable at this stage) when CI
 * runs; a vector mismatch on EITHER side fails CI.
 *
 * This is the cross-side integration test: it imports the SAME shared vectors
 * and exercises the relay codec (relay/src/broker/frame-codec) and the puller
 * codec (puller/src/channel/frame-codec) against them. The wire format is pinned
 * by the vectors' frozen `expectedWire` (an independent golden master), so any
 * codec change that alters the bytes — on either side — fails CI here.
 */

import { describe, expect, it } from "vitest";
import { CONFORMANCE_VECTORS } from "../shared/frame-protocol/vectors.js";
import { framesEqual } from "../shared/frame-protocol/index.js";
import { relayEncode, relayDecode } from "../relay/src/broker/frame-codec.js";
import { pullerEncode, pullerDecode } from "../puller/src/channel/frame-codec.js";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// A vector is only useful if it exists — guard the harness against an
// accidentally-empty vector table (which would make "all vectors pass" vacuous).
describe("AC2 — shared conformance vectors are present", () => {
  it("exports a non-empty vector set covering both request and response frames", () => {
    expect(CONFORMANCE_VECTORS.length).toBeGreaterThan(0);
    const types = new Set(CONFORMANCE_VECTORS.map((v) => v.frame.type));
    expect(types.has("request")).toBe(true);
    expect(types.has("response")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — the RELAY-side codec agrees with the shared vectors.
// A mismatch here fails CI.
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — relay-side codec conforms to the shared vectors", () => {
  for (const vector of CONFORMANCE_VECTORS) {
    it(`relay encode matches frozen wire: ${vector.id}`, () => {
      const out = relayEncode(vector.frame);
      expect(new TextDecoder().decode(out)).toBe(vector.expectedWire);
    });

    it(`relay decode round-trips the frozen wire: ${vector.id}`, () => {
      const decoded = relayDecode(utf8(vector.expectedWire));
      expect(framesEqual(decoded, vector.frame)).toBe(true);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — the PULLER-side codec agrees with the shared vectors.
// A mismatch here fails CI.
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — puller-side codec conforms to the shared vectors", () => {
  for (const vector of CONFORMANCE_VECTORS) {
    it(`puller encode matches frozen wire: ${vector.id}`, () => {
      const out = pullerEncode(vector.frame);
      expect(new TextDecoder().decode(out)).toBe(vector.expectedWire);
    });

    it(`puller decode round-trips the frozen wire: ${vector.id}`, () => {
      const decoded = pullerDecode(utf8(vector.expectedWire));
      expect(framesEqual(decoded, vector.frame)).toBe(true);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — cross-side interop: a frame encoded by one side decodes identically by
// the other. The relay and puller cannot drift apart on the wire.
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — cross-side interop (relay↔puller cannot drift)", () => {
  for (const vector of CONFORMANCE_VECTORS) {
    it(`relay-encoded bytes decode identically by puller: ${vector.id}`, () => {
      const wireOut = relayEncode(vector.frame);
      const decoded = pullerDecode(wireOut);
      expect(framesEqual(decoded, vector.frame)).toBe(true);
    });

    it(`puller-encoded bytes decode identically by relay: ${vector.id}`, () => {
      const wireOut = pullerEncode(vector.frame);
      const decoded = relayDecode(wireOut);
      expect(framesEqual(decoded, vector.frame)).toBe(true);
    });

    it(`relay and puller produce byte-identical wire: ${vector.id}`, () => {
      const relayOut = relayEncode(vector.frame);
      const pullerOut = pullerEncode(vector.frame);
      expect(new TextDecoder().decode(relayOut)).toBe(new TextDecoder().decode(pullerOut));
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — "a vector mismatch on either side fails CI": prove the harness has
// teeth. A deliberately-corrupted vector (wrong wire) MUST be rejected by both
// codecs. If this assertion ever stops failing on corruption, the conformance
// gate has been silently disarmed.
// ────────────────────────────────────────────────────────────────────────────
describe("AC2 — a vector mismatch is detected (the gate has teeth)", () => {
  const vector = CONFORMANCE_VECTORS[0]!;
  const corruptedWire = vector.expectedWire.replace("corr-001", "DIFFERENT-CORR");

  it("relay decode rejects a wire that does not round-trip to the frame", () => {
    const decoded = relayDecode(utf8(corruptedWire));
    expect(framesEqual(decoded, vector.frame)).toBe(false);
  });

  it("puller decode rejects a wire that does not round-trip to the frame", () => {
    const decoded = pullerDecode(utf8(corruptedWire));
    expect(framesEqual(decoded, vector.frame)).toBe(false);
  });

  it("a declared-size lie is rejected outright by both codecs", () => {
    const lie = vector.expectedWire.replace('"size":5', '"size":999');
    expect(() => relayDecode(utf8(lie))).toThrow();
    expect(() => pullerDecode(utf8(lie))).toThrow();
  });
});
