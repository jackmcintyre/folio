/**
 * Tool handler core — the `file` tool's delivery path (AD-1, FR-18).
 *
 * The handler validates an incoming `file` request against the published
 * contract and then delivers it through the Backend port's `deliver()` — and
 * NOTHING else. It imports neither the transport adapter nor the filesystem;
 * that one-way law (transport → handler → deliver → backend) is the
 * swappability invariant, mechanically enforced by folio/handler-layering
 * (Story 1.4). The handler is agnostic to which Backend is registered: the same
 * code path drives the stub Backend today and the v1 Relay Backend later, with
 * no change here — which is exactly what the seam test proves.
 *
 * The handler synthesises no Receipt and invents no outcome (AD-4): it returns
 * the Backend's Receipt or typed error verbatim. The one exception is a request
 * that fails contract validation, which is rejected as `invalid_path` BEFORE the
 * port is touched.
 */

import { validateFileInput, type TypedError } from "../../../shared/file-contract/index.js";
import { deliver, type DeliverResult } from "../backend/index.js";

/** A validated `file` request, narrowed to the fields the handler forwards. */
interface FileRequest {
  readonly content: string;
  readonly slug: string;
  readonly extension: string;
  readonly idempotencyKey: string;
}

/**
 * Handle one `file` call: validate against the published contract, then deliver
 * through the Backend port. Returns the Backend's Receipt or typed error
 * verbatim. A request that fails validation is rejected as `invalid_path` before
 * the port is touched.
 */
export async function handleFile(input: unknown): Promise<DeliverResult> {
  const validation = validateFileInput(input);
  if (!validation.ok) {
    return invalidPath(validation.errors);
  }
  const req = input as FileRequest;
  return deliver(
    { content: req.content, slug: req.slug, extension: req.extension },
    req.idempotencyKey,
  );
}

/** Build the `invalid_path` typed error for a request that fails validation. */
function invalidPath(errors: readonly string[]): TypedError {
  return { error: "invalid_path", message: `invalid file request: ${errors.join("; ")}` };
}
