/**
 * Puller-side frame codec — the channel's commitment point to the versioned
 * frame-protocol spec (AD-16 / Story 1.7).
 *
 * The puller is the WebSocket CLIENT on the Relay↔Puller hop (AD-15); every
 * frame it sends to or receives from the Relay passes through this codec. The
 * codec MUST agree with the shared conformance vectors (asserted in CI on BOTH
 * sides — see tests/frame-protocol-conformance.test.ts); a vector mismatch on
 * the puller side fails CI.
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

/** Encode a puller frame to its v1 wire bytes. */
export function pullerEncode(frame: Frame): Uint8Array {
  return canonicalEncode(frame);
}

/** Decode v1 wire bytes into a puller frame; throws on version/shape/size mismatch. */
export function pullerDecode(wire: Uint8Array): Frame {
  return canonicalDecode(wire);
}

export type {
  FrameRequest as PullerFrameRequest,
  FrameResponse as PullerFrameResponse,
  Frame as PullerFrame,
};
