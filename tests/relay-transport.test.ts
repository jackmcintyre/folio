/**
 * Relay transport tests — AC1, AC2, AC3 for Story 2.3 (Relay MCP transport, tool
 * handler, and RelayBackend adapter).
 *
 * The transport's logic is split into Node-testable cores (the broker pattern):
 *   - ./tools.ts        — the advertised catalogue (AC1)
 *   - ./guard.ts        — the stop-gap default-deny guard (AC3)
 *   - relay-backend.ts  — the RelayBackend adapter onto the frame protocol (AC2)
 * The Worker entry (transport/index.ts) only wires these to McpAgent + the DO;
 * proving the cores proves the story's observable contract under Node.
 *
 * AC2 is exercised END-TO-END through a REAL BrokerCore: a `file` call drives the
 * handler → deliver() → RelayBackend, and we assert the payload arrives at the
 * broker as a FRAME_PROTOCOL_VERSION request frame carrying the idempotency key
 * as a separate field (not in the body) — i.e. "forwarded via the DO over the
 * versioned frame protocol".
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  FILE_INPUT_REQUIRED_FIELDS,
  parseReceipt,
  parseTypedError,
  type Receipt,
} from "../shared/file-contract/index.js";
import {
  FRAME_PROTOCOL_VERSION,
  type FrameRequest,
  type FrameResponse,
} from "../shared/frame-protocol/index.js";
import { BrokerCore, type BrokerConnection } from "../relay/src/broker/index.js";
import {
  registerBackend,
  resetBackend,
  type DeliverPayload,
  type DeliverResult,
} from "../relay/src/backend/index.js";
import {
  RelayBackend,
  decodePayloadBody,
  encodePayloadBody,
  type FilingForwarder,
} from "../relay/src/backend/relay-backend.js";
import { handleFile } from "../relay/src/handler/index.js";
import { FOLIO_TOOLS } from "../relay/src/transport/tools.js";
import {
  StopGapGuard,
  extractStopGapCredential,
  parseAllowlist,
} from "../relay/src/transport/guard.js";

// A contract-valid Filing request expressed purely in the published vocabulary.
const VALID_INPUT = {
  content: "the body to file",
  slug: "my-note",
  extension: "md",
  idempotencyKey: "idem-key-test-fixture-0001", // fixture key matching the grammar gitleaks:allow
} as const;

const RECEIPT: Receipt = {
  v: "1",
  path: "notes/2026/06",
  filename: "2026-06-29-090000-my-note.md",
  timestamp: "2026-06-29T09:00:00+10:00",
};

afterEach(() => {
  resetBackend();
});

// ────────────────────────────────────────────────────────────────────────────
// AC1 — exactly one tool (`file`) is advertised; no read/list/delete tools.
// ────────────────────────────────────────────────────────────────────────────
describe("AC1 — the advertised catalogue exposes exactly one tool, `file`", () => {
  it("advertises exactly one tool, named `file`", () => {
    expect(FOLIO_TOOLS).toHaveLength(1);
    expect(FOLIO_TOOLS[0]!.name).toBe("file");
  });

  it("advertises NO read, list, or delete tool", () => {
    const names = FOLIO_TOOLS.map((t) => t.name);
    for (const forbidden of ["read", "list", "delete"]) {
      expect(names).not.toContain(forbidden);
      expect(names.some((n) => n.includes(forbidden))).toBe(false);
    }
  });

  it("derives the `file` input schema from the pinned contract (no drift)", () => {
    const schema = FOLIO_TOOLS[0]!.inputSchema;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    // Every required contract field is advertised as a required property.
    expect([...schema.required].sort()).toEqual([...FILE_INPUT_REQUIRED_FIELDS].sort());
    for (const field of FILE_INPUT_REQUIRED_FIELDS) {
      expect(schema.properties[field]).toBeDefined();
      expect(schema.properties[field]!.type).toBe("string");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC2 — the RelayBackend forwards the payload via the broker over the versioned
// frame protocol; the handler validates then delivers ONLY through the port.
// ────────────────────────────────────────────────────────────────────────────

/** A BrokerConnection double that records every frame the broker forwards. */
class FakeConnection implements BrokerConnection {
  readonly sent: FrameRequest[] = [];
  send(frame: FrameRequest): void {
    this.sent.push(frame);
  }
}

/** A deterministic, never-repeating correlation-id source. */
function counterIds(): () => string {
  let n = 0;
  return () => `cid-${String(++n).padStart(4, "0")}`;
}

/** Build a response frame carrying `result` for `correlationId`. */
function response(correlationId: string, result: Receipt): FrameResponse {
  const size = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  return { v: FRAME_PROTOCOL_VERSION, type: "response", correlationId, result, size };
}

/** A forwarder backed by a real BrokerCore (proves frame-protocol marshalling). */
function brokerBackedForwarder(core: BrokerCore): FilingForwarder {
  return {
    async forward(body: Uint8Array, idempotencyKey: string): Promise<DeliverResult> {
      return (await core.dispatch(body, idempotencyKey)) as DeliverResult;
    },
  };
}

/** A forwarder that records its inputs and returns a fixed outcome. */
class RecordingForwarder implements FilingForwarder {
  readonly bodies: Uint8Array[] = [];
  readonly keys: string[] = [];
  constructor(private readonly outcome: DeliverResult) {}
  forward(body: Uint8Array, idempotencyKey: string): Promise<DeliverResult> {
    this.bodies.push(body);
    this.keys.push(idempotencyKey);
    return Promise.resolve(this.outcome);
  }
}

describe("AC2 — the RelayBackend forwards the payload over the frame protocol", () => {
  it("marshals the payload into the body and keeps the idempotency key separate", async () => {
    const forwarder = new RecordingForwarder(RECEIPT);
    const backend = new RelayBackend(forwarder);
    const payload: DeliverPayload = {
      content: VALID_INPUT.content,
      slug: VALID_INPUT.slug,
      extension: VALID_INPUT.extension,
    };

    await backend.deliver(payload, VALID_INPUT.idempotencyKey);

    // The idempotency key travels as the separate port argument (AD-5/AD-19).
    expect(forwarder.keys).toEqual([VALID_INPUT.idempotencyKey]);
    // The body carries the whole payload, and NOT the idempotency key.
    const decoded = decodePayloadBody(forwarder.bodies[0]!);
    expect(decoded).toEqual(payload);
    expect(new TextDecoder().decode(forwarder.bodies[0]!)).not.toContain(
      VALID_INPUT.idempotencyKey,
    );
  });

  it("forwards a FRAME_PROTOCOL_VERSION request frame through the broker", async () => {
    const core = new BrokerCore(counterIds());
    const conn = new FakeConnection();
    core.attach(conn);
    registerBackend(new RelayBackend(brokerBackedForwarder(core)));

    // A real `file` call: the handler validates then delivers only via the port.
    const pending = handleFile(VALID_INPUT);

    // The broker forwarded exactly one request frame at the pinned version,
    // carrying the idempotency key separately and the payload in the body.
    expect(conn.sent).toHaveLength(1);
    const frame = conn.sent[0]!;
    expect(frame.v).toBe(FRAME_PROTOCOL_VERSION);
    expect(frame.type).toBe("request");
    expect(frame.idempotencyKey).toBe(VALID_INPUT.idempotencyKey);
    expect(frame.size).toBe(frame.body.byteLength);
    expect(decodePayloadBody(frame.body)).toEqual({
      content: VALID_INPUT.content,
      slug: VALID_INPUT.slug,
      extension: VALID_INPUT.extension,
    });

    // The Puller's Receipt crosses back unchanged and the handler returns it.
    core.onResponse(response(frame.correlationId, RECEIPT), core.currentEpoch);
    const result = await pending;
    const parsed = parseReceipt(result);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(RECEIPT);
    }
  });

  it("hard-fails `puller_offline` when no Puller connection is registered", async () => {
    // The broker has no connection: a `file` call returns a typed failure rather
    // than hanging or crashing (the story's stated failure behaviour).
    const core = new BrokerCore(counterIds());
    registerBackend(new RelayBackend(brokerBackedForwarder(core)));

    const result = await handleFile(VALID_INPUT);
    const parsed = parseTypedError(result);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.error).toBe("puller_offline");
    }
  });

  it("round-trips the body codec (encode∘decode is identity)", () => {
    const payload: DeliverPayload = { content: "hi\nthere", slug: "s", extension: "txt" };
    expect(decodePayloadBody(encodePayloadBody(payload))).toEqual(payload);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AC3 — default-deny stop-gap guard: no request reaches deliver() without it.
// ────────────────────────────────────────────────────────────────────────────
describe("AC3 — the stop-gap guard is default-deny", () => {
  it("denies a request that presents no credential (default-deny)", () => {
    const guard = new StopGapGuard(["secret-stopgap-token-aaaa"]);
    const decision = guard.authorize(undefined);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.error.error).toBe("unauthorized");
    }
  });

  it("denies EVERYTHING when the allowlist is unconfigured (fail-closed)", () => {
    const guard = new StopGapGuard(parseAllowlist(undefined));
    expect(guard.isArmed).toBe(false);
    // Even a non-empty presented credential is denied: an unarmed guard is sealed.
    expect(guard.authorize("anything-at-all").allowed).toBe(false);
    expect(guard.authorize(undefined).allowed).toBe(false);
  });

  it("denies a credential that is not on the allowlist", () => {
    const guard = new StopGapGuard(["secret-stopgap-token-aaaa"]);
    expect(guard.authorize("wrong-token").allowed).toBe(false);
  });

  it("allows only an exact allowlist match", () => {
    const guard = new StopGapGuard(["secret-stopgap-token-aaaa"]);
    expect(guard.isArmed).toBe(true);
    expect(guard.authorize("secret-stopgap-token-aaaa").allowed).toBe(true);
  });

  it("extracts a bearer credential from the Authorization header", () => {
    expect(extractStopGapCredential("Bearer abc123")).toBe("abc123");
    expect(extractStopGapCredential("Bearer   ")).toBeUndefined();
    expect(extractStopGapCredential("Basic abc123")).toBeUndefined();
    expect(extractStopGapCredential(null)).toBeUndefined();
    expect(extractStopGapCredential(undefined)).toBeUndefined();
  });

  it("parses a comma/space separated allowlist from the raw env value", () => {
    expect(parseAllowlist("a, b  c,,d")).toEqual(["a", "b", "c", "d"]);
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it("a request without the guard NEVER reaches deliver() (no Filing triggered)", async () => {
    // Compose the exact boundary the Worker entry applies: authorize first, and
    // only on allow call the handler. A counting Backend proves deliver() is not
    // reached when the guard denies — an unauthenticated request triggers no
    // Filing.
    const forwarder = new RecordingForwarder(RECEIPT);
    registerBackend(new RelayBackend(forwarder));
    const guard = new StopGapGuard(parseAllowlist(undefined)); // unarmed: default-deny

    const decision = guard.authorize(extractStopGapCredential(null));
    const result: DeliverResult = decision.allowed ? await handleFile(VALID_INPUT) : decision.error;

    expect(decision.allowed).toBe(false);
    expect(forwarder.keys).toHaveLength(0); // deliver() never forwarded anything
    const parsed = parseTypedError(result);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.error).toBe("unauthorized");
    }
  });
});
