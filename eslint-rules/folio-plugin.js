// Folio architectural-invariant lint plugin (Story 1.4).
//
// Two custom rules that mechanically enforce the AD-1 layering law and its
// companion "generic-by-contract" rule, so the swappability invariant does not
// depend on human review:
//
//   - folio/handler-layering          (AC1) — the handler core may import ONLY
//     the Backend port (deliver). Importing the transport adapter or the Node
//     filesystem directly welds the v1 Relay path into the core and kills the
//     hosted-Backend fast-follow. (ARCHITECTURE-SPINE.md AD-1.)
//   - folio/no-claude-kb-identifiers  (AC2) — relay/ and puller/ must carry no
//     Claude- or KB-specific identifier, so the product stays a generic MCP
//     server and the existing KB sync stays a separate container. (AD-1
//     companion lint; project-context "generic-by-contract".)
//
// These rules are PURPOSELY text/AST-level (no type information, no resolver):
// they must fire deterministically on a planted violation and stay quiet on
// legitimate cross-cutting code. Each rule is mutation-checked in
// tests/lint.test.ts — a gate with no test that fails on a planted violation is
// not done.

import path from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// AC2 — forbidden-token denylist.
//
// Canonical source: the story's AC2 enumerates the case-insensitive tokens
// `claude`, `anthropic`, `knowledgebase`, `knowledge-base`, `knowledge_base`,
// and an import from any `@anthropic-ai/*` package. The bare token `kb` is
// explicitly EXCLUDED (it is a common substring: "webhook", "feedback").
//
// The rule scans the WHOLE source text — identifiers, strings, and comments —
// because the invariant is about the product's vocabulary, not just identifiers.
// "knowledge-base" / "knowledge_base" carry a separator so they are matched as
// explicit phrases; the bare-word tokens use \b word boundaries so "claudex" or
// "anthropic-ish" substrings of a larger identifier are NOT false-flagged while
// the standalone word still is.
// ───────────────────────────────────────────────────────────────────────────
const DENYLIST_TOKENS = ["claude", "anthropic", "knowledgebase"];
const DENYLIST_PHRASES = ["knowledge-base", "knowledge_base"];

// The three vendor tokens are matched case-insensitively as SUBSTRINGS, not
// whole words. No generic identifier legitimately contains "claude",
// "anthropic", or "knowledgebase", so substring matching is false-positive-free
// here AND correctly catches compound identifiers that embed the vendor name
// (e.g. `claudeConnector`, `anthropicChannel`) — the whole point of the
// generic-by-contract rule. (The bare token `kb`, which DOES appear inside
// generic words like "webhook"/"feedback", is excluded entirely — see below.)
// The `g` flag is required for matchAll. Substring "anthropic" also matches
// inside an "@anthropic-ai/*" import specifier, so the denylist scan alone
// covers that token everywhere; the dedicated ImportDeclaration check below
// only adds an unambiguous message.
const DENYLIST_RE = new RegExp(
  `(?:${DENYLIST_TOKENS.join("|")})|${DENYLIST_PHRASES.map((p) => p.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")}`,
  "gi",
);

const noClaudeKbIdentifiers = {
  meta: {
    type: "problem",
    docs: {
      description:
        "AD-1 companion: no Claude-/KB-specific identifiers in relay/ or puller/ (generic-by-contract).",
    },
    schema: [],
    messages: {
      forbiddenToken:
        "AD-1 companion: forbidden '{{token}}' token in relay/puller source — the product must stay generic-by-contract (no Claude/KB identifiers).",
      forbiddenImport:
        "AD-1 companion: importing from '{{spec}}' is forbidden in relay/puller source — the product must stay generic-by-contract (no @anthropic-ai/* imports).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    if (!sourceCode) return {};

    return {
      // 1. Static import declarations: catch @anthropic-ai/* imports at the
      //    AST level with a dedicated, unambiguous message. (Plain case-folded
      //    includes — no regex, so no lastIndex statefulness across visits.)
      ImportDeclaration(node) {
        const spec = String(node.source.value ?? "");
        if (spec.toLowerCase().includes("@anthropic-ai/")) {
          context.report({ node, messageId: "forbiddenImport", data: { spec } });
        }
      },
      // 2. Whole-source text scan for the denylist tokens (identifiers +
      //    strings + comments). Run once per Program; reported with precise loc
      //    derived from the match offset. This scan also catches "anthropic"
      //    inside an @anthropic-ai/ specifier, so the package rule cannot be
      //    bypassed by a dynamic import()/require either.
      Program(node) {
        const text = sourceCode.text;
        // matchAll carries lastIndex state on the regex object; reset it so the
        // same global regex is safe to reuse across files.
        DENYLIST_RE.lastIndex = 0;
        for (const match of text.matchAll(DENYLIST_RE)) {
          const token = match[0];
          const idx = match.index;
          if (token === undefined || idx === undefined) continue;
          const loc = sourceCode.getLocFromIndex(idx);
          context.report({
            loc,
            node,
            messageId: "forbiddenToken",
            data: { token },
          });
        }
      },
    };
  },
};

// ───────────────────────────────────────────────────────────────────────────
// AC1 — AD-1 layering law.
//
// Files under relay/src/handler/** may NOT import:
//   - the transport adapter (relay/src/transport/**); the handler must reach the
//     driving adapter only via the one-way dependency `transport -> handler`.
//   - the Node filesystem (the fs family); the handler must call only deliver().
//
// The fs check matches the exact Node builtins and their subpaths. The transport
// check resolves the import specifier against the importing file and asks
// whether it lands inside relay/src/transport. `repoRoot` is supplied from the
// flat config (computed from the config file's own location) so resolution is
// independent of the process cwd.
// ───────────────────────────────────────────────────────────────────────────
const FS_BUILTINS = ["node:fs", "fs", "node:fs/promises", "fs/promises"];

function isFsModule(spec) {
  const s = String(spec);
  if (FS_BUILTINS.includes(s)) return true;
  // Subpaths of the Node fs builtins (e.g. node:fs/sync, fs/sync). The leading
  // "fs/" / "node:fs/" prefix only matches the builtin (a package such as
  // "fs-extra" has no slash and does not start with "fs/").
  if (s.startsWith("node:fs/")) return true;
  if (s.startsWith("fs/")) return true;
  return false;
}

function isRelative(spec) {
  const s = String(spec);
  return s.startsWith("./") || s.startsWith("../");
}

const handlerLayering = {
  meta: {
    type: "problem",
    docs: {
      description:
        "AD-1: the handler core must import only the Backend port — never transport or the filesystem.",
    },
    schema: [
      {
        type: "object",
        properties: { repoRoot: { type: "string" } },
        additionalProperties: false,
      },
    ],
    messages: {
      transportImport:
        "AD-1 layering law: relay/handler must not import relay/transport directly (bypassing the Backend port) — import only deliver().",
      fsImport:
        "AD-1 layering law: relay/handler must not import the filesystem ('{{spec}}') directly — the handler calls only deliver().",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const repoRoot = options.repoRoot;
    if (!repoRoot) {
      // No anchor configured: refuse to silently skip. This is a wiring error.
      throw new Error(
        "folio/handler-layering: the 'repoRoot' option is required (the flat config must pass it).",
      );
    }
    const transportDir = path.resolve(repoRoot, "relay", "src", "transport");

    function checkSpec(specValue, node) {
      const spec = String(specValue);
      if (isFsModule(spec)) {
        context.report({ node, messageId: "fsImport", data: { spec } });
        return;
      }
      if (isRelative(spec)) {
        const filename = context.filename;
        const resolved = path.resolve(path.dirname(filename), spec);
        if (resolved === transportDir || resolved.startsWith(transportDir + path.sep)) {
          context.report({ node, messageId: "transportImport" });
        }
      }
    }

    return {
      ImportDeclaration(node) {
        checkSpec(node.source.value, node);
      },
      ImportExpression(node) {
        // Dynamic import("..."). Only flag static string operands.
        const src = node.source;
        if (src && src.type === "Literal" && typeof src.value === "string") {
          checkSpec(src.value, node);
        }
      },
      // Re-exports (`export ... from "..."`) also load the module, so a handler
      // must not bypass the law by re-exporting transport/fs either.
      ExportNamedDeclaration(node) {
        if (node.source && node.source.value) checkSpec(node.source.value, node);
      },
      ExportAllDeclaration(node) {
        if (node.source && node.source.value) checkSpec(node.source.value, node);
      },
    };
  },
};

export default {
  meta: { name: "folio" },
  rules: {
    "handler-layering": handlerLayering,
    "no-claude-kb-identifiers": noClaudeKbIdentifiers,
  },
};
