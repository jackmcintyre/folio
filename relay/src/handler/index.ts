/**
 * relay/src/handler
 *
 * The `file` tool handler — the hexagonal core (AD-1).
 * Validates the incoming call, then calls `deliver()` on the Backend port.
 * Contains no transport or filesystem calls; never reaches outside the Backend port.
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

import type { Backend, Receipt } from "../backend/index.js";

export interface FileToolArgs {
  content: string;
  filename?: string;
  idempotencyKey: string;
}

/**
 * Handles a single `file` tool call.  Validates args, then delegates to `deliver`.
 * Stub — throws until implemented.
 */
export async function handleFileTool(
  _args: FileToolArgs,
  _backend: Backend,
): Promise<Receipt> {
  throw new Error("handler: not implemented (Story 1.2+)");
}
