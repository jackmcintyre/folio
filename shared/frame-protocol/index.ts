/**
 * frame-protocol — versioned Relay↔Puller private channel spec (AD-16).
 *
 * This module is the single source of truth for the wire format.  Both relay/
 * and puller/ import from here; conformance vectors are asserted in CI on both
 * sides.
 *
 * Placeholder: types and conformance vectors are the subject of a later story.
 */

export const FRAME_PROTOCOL_VERSION = "1" as const;
