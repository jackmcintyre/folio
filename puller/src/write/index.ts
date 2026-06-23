/**
 * puller/src/write
 *
 * Sole filesystem writer — the atomic publish pipeline (AD-3, AD-6, AD-7):
 *   1. Path containment (single audited primitive, AD-6):
 *      decode → NFC normalise → resolve → relative assertion → realpath
 *   2. Temp-write the payload.
 *   3. Integrity gate: verify size + checksum match the intended payload (AD-7).
 *   4. Atomic rename (O_EXCL guard, O_NOFOLLOW re-assertion) to final path.
 *   5. Mint and return the Receipt.
 *
 * Filename: YYYY-MM-DD-HHmmss-<slug>.<ext> in Australia/Sydney timezone (AD-7).
 *
 * Writes group-writable under umask 002, sharing PUID:PGID with the KB sync (AD-3).
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

export {};
