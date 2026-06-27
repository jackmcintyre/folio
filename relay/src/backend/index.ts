/**
 * Backend port — the one seam through which the tool handler delivers a Filing
 * (AD-1, AD-2; FR-18; AR-4).
 *
 * The handler core reaches the outside world ONLY through `deliver(payload,
 * idempotencyKey)`: it never touches the transport adapter or the filesystem
 * (the AD-1 layering law, mechanically enforced by folio/handler-layering from
 * Story 1.4). A concrete Backend — the v1 Relay Backend later, or a stub today —
 * is registered behind this port with `registerBackend`; swapping the
 * implementation requires NO change to the `file` schema, the auth model, or the
 * handler. That swappability is the product's core bet, and the seam test
 * (tests/backend-seam.test.ts) proves it before the real Backend exists.
 *
 * Contract (AD-2): `deliver(payload, idempotencyKey) → Receipt | TypedError`.
 * The Receipt is the pinned, versioned shape minted once by the Puller; a typed
 * error is one of the canonical eight tokens. Both shapes are the SINGLE source
 * of truth in shared/file-contract — this port re-uses them rather than
 * redefining them, so the seam cannot drift from the published contract.
 */

import type { Receipt, TypedError } from "../../../shared/file-contract/index.js";

/**
 * The content of one Filing handed to a Backend. The idempotency key travels as
 * a SEPARATE argument to `deliver` (it anchors reconciliation — AD-5/AD-19) and
 * so is deliberately not part of the payload body.
 */
export interface DeliverPayload {
  /** The text body to file. */
  readonly content: string;
  /** Path-safe name/slug hint feeding server-side filename derivation. */
  readonly slug: string;
  /** Extension / content-type hint for the derived filename (no leading dot). */
  readonly extension: string;
}

/** The outcome of a delivery: a contract-valid Receipt or a typed error. */
export type DeliverResult = Receipt | TypedError;

/**
 * The Backend port. A single method: deliver one payload under one idempotency
 * key and return a Receipt or a typed error. The v1 Relay Backend and any stub
 * implement exactly this — nothing wider — so the handler stays agnostic to the
 * implementation behind the seam.
 */
export interface Backend {
  deliver(payload: DeliverPayload, idempotencyKey: string): Promise<DeliverResult>;
}

// The single registered Backend. Module-level so the handler reaches it through
// the stable `deliver` export without knowing which implementation is wired —
// that indirection IS the swappability seam.
let registered: Backend | undefined;

/**
 * Register the Backend that sits behind the port. The most recent registration
 * wins: a test swaps in a stub; production wires the Relay Backend once.
 */
export function registerBackend(backend: Backend): void {
  registered = backend;
}

/**
 * Clear the registered Backend, restoring the unwired state. Used by the seam
 * test to prove the handler can only reach the world via the port.
 */
export function resetBackend(): void {
  registered = undefined;
}

/**
 * Deliver a Filing through the registered Backend — the ONLY path the handler
 * uses to reach the outside world (AD-1). Throws if no Backend is registered: an
 * unwired port is a construction error, not a Filing outcome, so it fails loudly
 * rather than masquerade as a typed error.
 */
export function deliver(payload: DeliverPayload, idempotencyKey: string): Promise<DeliverResult> {
  if (registered === undefined) {
    throw new Error("Backend port: no Backend registered — call registerBackend() first.");
  }
  return registered.deliver(payload, idempotencyKey);
}
