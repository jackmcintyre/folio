/**
 * relay/src/backend
 *
 * The Backend port (AD-2) and the RelayBackend adapter.
 *
 * The Backend port is the single seam the entire product bet rests on (FR-18).
 * Its contract is pinned and versioned; no layer may reshape a Receipt.
 *
 *   deliver(payload, idempotencyKey) → Receipt | TypedError
 *
 * Receipt shape (AD-2, AD-13, Consistency Conventions):
 *   { v, path (relative to Target directory), filename, timestamp (ISO-8601 with offset) }
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

/** Versioned Receipt — minted once by the Puller, immutable thereafter (AD-2, AD-4). */
export interface Receipt {
  /** Protocol version — increment when the shape changes. */
  v: 1;
  /** Path relative to the Target directory. */
  path: string;
  /** Final filename (YYYY-MM-DD-HHmmss-<slug>.<ext>, Australia/Sydney tz). */
  filename: string;
  /** ISO-8601 with UTC offset, e.g. "2026-06-23T10:00:00+10:00". */
  timestamp: string;
}

/** Payload carried over the Backend port to the Puller. */
export interface FilingPayload {
  content: string;
  filename?: string;
}

/** The Backend port (AD-2).  Implement with RelayBackend for v1; swap for the hosted backend later. */
export interface Backend {
  deliver(payload: FilingPayload, idempotencyKey: string): Promise<Receipt>;
}

/**
 * RelayBackend — v1 adapter behind the Backend port.
 * Forwards `deliver` calls through the Durable Object broker to the Puller.
 *
 * Stub — throws until the DO binding and frame protocol are wired (Story 1.2+).
 */
export class RelayBackend implements Backend {
  async deliver(
    _payload: FilingPayload,
    _idempotencyKey: string,
  ): Promise<Receipt> {
    throw new Error("RelayBackend: not implemented (Story 1.2+)");
  }
}
