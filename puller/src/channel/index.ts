/**
 * puller/src/channel
 *
 * Outbound WebSocket client (AD-15): connects to the Durable Object broker,
 * authenticates via static bearer token (AD-10), and speaks the frame protocol (AD-16).
 *
 * This module is the Puller side of the private Relay↔Puller channel.
 * No MCP SDK is used here — the hop is a private framed protocol, not MCP.
 *
 * Frame protocol types are defined in shared/frame-protocol (AD-16); they are
 * re-exported from here for convenience within the puller workspace once the
 * shared package is wired as a workspace dependency (Story 1.2+).
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

export {};
