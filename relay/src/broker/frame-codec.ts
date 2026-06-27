/**
 * Relay-side frame codec — the broker's commitment point to the versioned
 * frame-protocol spec (AD-16 / Story 1.7).
 *
 * The broker owns the persistent Relay↔Puller WebSocket (AD-15/AD-18); every
 * frame it sends to or receives from the Puller passes through this codec. The
 * codec MUST agree with the shared conformance vectors (asserted in CI on BOTH
 * sides — see tests/frame-protocol-conformance.test.ts); a vector mismatch on
 * the relay side fails CI.
 *
 * STAGE: stub. Today this delegates to the single canonical codec in
 * `@folio/frame-protocol` (the spec governs — AD-16). When Epic 2 wires the real
 * transport-integrated codec here, that implementation must still pass the same
 * shared vectors; the conformance harness is armed against drift, not bypassed
 * (mirroring the rigour-seam coverage gates).
 */

import type { Frame, FrameRequest, FrameResponse } from "../../../shared/frame-protocol/index.js";
import {
  encode as canonicalEncode,
  decode as canonicalDecode,
} from "../../../shared/frame-protocol/index.js";

/** Encode a relay frame to its v1 wire bytes. */
export function relayEncode(frame: Frame): Uint8Array {
  return canonicalEncode(frame);
}

/** Decode v1 wire bytes into a relay frame; throws on version/shape/size mismatch. */
export function relayDecode(wire: Uint8Array): Frame {
  return canonicalDecode(wire);
}

// Re-export the request/response builders' TYPES so the broker can construct
// frames without reaching across to the shared package in its own domain code.
export type {
  FrameRequest as RelayFrameRequest,
  FrameResponse as RelayFrameResponse,
  Frame as RelayFrame,
};
