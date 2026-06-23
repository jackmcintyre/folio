/**
 * relay/src/transport
 *
 * MCP Streamable HTTP transport (McpAgent), edge guard, and error-envelope renderer.
 * Drives the public face of Folio: accepts MCP calls from Claude, enforces edge-level
 * size/rate limits (AD-9), and passes authorised requests to the tool handler (AD-1).
 *
 * This file is the Wrangler entry-point (wrangler.toml `main`).
 *
 * Implemented in Story 1.2+.  This stub satisfies the scaffold AC (Story 1.1).
 */

export { BrokerDO } from "../broker/index.js";

const handler: ExportedHandler = {
  async fetch(_req: Request): Promise<Response> {
    return new Response("Folio relay — scaffold stub", { status: 503 });
  },
};

export default handler;
