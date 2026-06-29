/**
 * transport tools — the advertised MCP tool catalogue (FR-1, AD-1; Story 2.3 AC1).
 *
 * Folio advertises EXACTLY ONE tool over MCP: `file`. There is no read, list,
 * or delete tool — Folio is write-only by construction (FR-1), and that single
 * tool surface is asserted by AC1's catalogue test. The tool's input schema is
 * DERIVED from the pinned `file` contract (shared/file-contract) rather than
 * hand-written here, so the advertised surface can never drift from the contract
 * the handler validates against: one source of truth, two consumers (the MCP
 * `tools/list` advertisement and the handler's `validateFileInput`).
 *
 * This module is transport-agnostic and dependency-free (no MCP SDK, no Workers
 * runtime) so the catalogue is unit-testable under Node; the Worker entry
 * (./index.ts) feeds `FOLIO_TOOLS` straight into the MCP server's tools/list.
 */

import { FILE_INPUT_SCHEMA, type FieldSpec } from "../../../shared/file-contract/index.js";

/** A JSON-Schema string property (the only field type the `file` tool uses). */
export interface JsonSchemaStringProperty {
  readonly type: "string";
  readonly description: string;
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}

/** The JSON-Schema object an MCP client reads to construct a valid tool call. */
export interface JsonObjectSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchemaStringProperty>>;
  readonly required: readonly string[];
  /** No field outside the published contract is accepted. */
  readonly additionalProperties: false;
}

/** One advertised MCP tool: name + human description + input JSON Schema. */
export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObjectSchema;
}

/** Project one contract field spec onto its JSON-Schema property. */
function propertyFor(spec: FieldSpec): JsonSchemaStringProperty {
  return {
    type: "string",
    description: spec.description,
    ...(spec.pattern !== undefined ? { pattern: spec.pattern } : {}),
    ...(spec.minLength !== undefined ? { minLength: spec.minLength } : {}),
    ...(spec.maxLength !== undefined ? { maxLength: spec.maxLength } : {}),
  };
}

/** Build the `file` input JSON Schema from the pinned contract descriptor. */
function fileInputJsonSchema(): JsonObjectSchema {
  const properties: Record<string, JsonSchemaStringProperty> = {};
  const required: string[] = [];
  for (const spec of FILE_INPUT_SCHEMA.fields) {
    properties[spec.name] = propertyFor(spec);
    if (spec.required) {
      required.push(spec.name);
    }
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * The single `file` tool Folio advertises. Write-only: it files a text body and
 * returns a Receipt; it cannot read, list, or delete. The final filename is
 * derived server-side from the slug + extension hints.
 */
export const FILE_TOOL: ToolDescriptor = {
  name: "file",
  description:
    "Write a text body to a new file and return a Receipt. Folio's only tool: " +
    "it is write-only (no read, list, or delete). The final filename is derived " +
    "server-side from the slug and extension hints.",
  inputSchema: fileInputJsonSchema(),
};

/**
 * The complete advertised catalogue — EXACTLY one tool (FR-1 / AC1). Anything
 * that lists tools over MCP reads this; the AC1 test asserts its length is 1 and
 * its sole entry is `file`.
 */
export const FOLIO_TOOLS: readonly ToolDescriptor[] = [FILE_TOOL];
