/**
 * puller/src/dedupe
 *
 * Durable idempotency store — the reconciliation source of truth (AD-5, AD-13, AD-19).
 *
 * Implements compare-and-set on the idempotency key (hashed — AD-19) to serialise
 * concurrent same-key first calls.  The store survives restart and holds the
 * reserved filename + Receipt for the bounded retention window (7 days — §10.7).
 *
 * Store entries: { keyHash, reservedFilename, receipt?, status: "pending" | "committed" }
 * No payload content is stored (AD-21).
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

export {};
