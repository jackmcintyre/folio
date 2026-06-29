/**
 * transport — the public MCP Streamable HTTP entry for Folio (FR-1, FR-4, FR-18;
 * AD-1, AD-15/AD-16; Story 2.3).
 *
 * This is the Worker entry named in `relay/wrangler.toml` (`main`). It is the
 * THIN Workers adapter over the Node-testable cores, mirroring the broker split
 * (core.ts decides; durable-object.ts adapts): the tool catalogue (./tools.ts),
 * the stop-gap guard (./guard.ts), the handler (../handler), and the RelayBackend
 * (../backend/relay-backend.ts) carry the logic and are unit-tested under Node;
 * this file only wires them to the MCP server and the Durable Object broker.
 *
 * Request flow:
 *   1. STOP-GAP GUARD (AC3) — a default-deny boundary check refuses any request
 *      that does not present the interim credential BEFORE it can reach the MCP
 *      agent (and therefore before `deliver()` / any Filing). This is interim:
 *      Epic 4 replaces it with operator-gated OAuth in `relay/src/auth`. The
 *      endpoint is never exposed publicly without that auth.
 *   2. MCP transport — exactly one tool, `file`, is advertised (AC1). A `file`
 *      call routes to the handler, which validates against the pinned contract
 *      and delivers ONLY through the Backend port (AD-1); the registered
 *      RelayBackend marshals onto the frame protocol and forwards via the DO
 *      broker (AC2).
 *
 * The DO broker class lives in ../broker/durable-object.ts (RelayBroker); this
 * entry re-exports it so Wrangler's `[durable_objects]` binding can resolve it
 * from the single `main` module.
 */

import { McpAgent } from "agents/mcp";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

import { registerBackend, type DeliverResult } from "../backend/index.js";
import { RelayBackend, type FilingForwarder } from "../backend/relay-backend.js";
import { handleFile } from "../handler/index.js";
import { FOLIO_TOOLS } from "./tools.js";
import { StopGapGuard, extractStopGapCredential, parseAllowlist } from "./guard.js";

export { RelayBroker } from "../broker/durable-object.js";

/** Bindings + config the transport reads from the Worker environment. */
export interface TransportEnv {
  /** The single-Puller broker Durable Object (one instance brokers the Puller). */
  readonly RELAY_BROKER: DurableObjectNamespace;
  /**
   * Interim stop-gap credential allowlist (comma/space separated). Absent or
   * blank ⇒ the guard is unarmed and denies everything (default-deny — AC3).
   */
  readonly STOP_GAP_TOKENS?: string;
}

/** The fixed name of the singleton broker DO instance (one Puller, one broker). */
const BROKER_SINGLETON = "puller";

/** A forwarder that delivers a Filing to the Puller via the bound DO broker. */
function brokerForwarder(stub: DurableObjectStub): FilingForwarder {
  return {
    async forward(body: Uint8Array, idempotencyKey: string): Promise<DeliverResult> {
      const response = await stub.fetch("https://relay-broker.internal/dispatch", {
        method: "POST",
        body,
        headers: { "X-Folio-Idempotency-Key": idempotencyKey },
      });
      return (await response.json()) as DeliverResult;
    },
  };
}

/** Render a Filing outcome as an MCP tool result (Receipt or typed error). */
function toToolResult(outcome: DeliverResult): CallToolResult {
  const isError = "error" in outcome;
  return {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * The Folio MCP agent: advertises exactly one tool (`file`) and routes a call to
 * the handler, which delivers only through the Backend port (AD-1). The
 * RelayBackend is registered against the bound DO broker on init.
 */
export class FolioMcp extends McpAgent<TransportEnv> {
  server = new Server({ name: "folio", version: "1" }, { capabilities: { tools: {} } });

  async init(): Promise<void> {
    const namespace = this.env.RELAY_BROKER;
    const stub = namespace.get(namespace.idFromName(BROKER_SINGLETON));
    registerBackend(new RelayBackend(brokerForwarder(stub)));

    this.server.setRequestHandler(
      ListToolsRequestSchema,
      (): ListToolsResult => ({ tools: FOLIO_TOOLS as unknown as ListToolsResult["tools"] }),
    );
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      if (name !== "file") {
        return toToolResult({ error: "invalid_path", message: `unknown tool: ${name}` });
      }
      return toToolResult(await handleFile(args));
    });
  }
}

/** The Streamable HTTP MCP handler (built once, reused per request). */
const mcpHandler = FolioMcp.serve("/mcp");

export default {
  /**
   * The Worker fetch entry. Applies the stop-gap default-deny guard at the
   * boundary (AC3) — an unauthenticated request is refused before it can reach
   * the MCP agent or `deliver()` — then serves the MCP transport.
   */
  async fetch(request: Request, env: TransportEnv, ctx: ExecutionContext): Promise<Response> {
    const guard = new StopGapGuard(parseAllowlist(env.STOP_GAP_TOKENS));
    const credential = extractStopGapCredential(request.headers.get("authorization"));
    const decision = guard.authorize(credential);
    if (!decision.allowed) {
      return Response.json(decision.error, { status: 401 });
    }
    return mcpHandler.fetch(request, env, ctx);
  },
};
