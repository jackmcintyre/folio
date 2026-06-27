---
title: Folio — Anti-pattern log
type: anti-pattern-log
version: "0.1.0"
updated: "2026-06-27"
status: living
---

# Folio — Anti-pattern log

A living record of deliberate deviations from the default rules. Each entry says
**what** the deviation is, **why** it was allowed, **who** signed off, and the
**mitigation** that keeps the risk bounded. An agent that sees hand-rolled code
in one of these areas must NOT treat the entry as a licence to hand-roll
elsewhere — the deviation is scoped to the named seam only.

To add an entry: append a new `## AP-n` section with the same fields. Never
delete an entry; supersede it with a dated note if a deviation is retired.

---

## AP-1 — Path containment uses no vetted library

- **Deviation from:** the "use a vetted library, don't hand-roll" rule in
  `docs/primitive-allowlist.md` (and the architecture addendum).
- **Scope:** `puller/src/write` — the single audited path-containment primitive
  (AD-6) only. Nothing else.
- **What:** no third-party containment library is used. All path derivation flows
  through ONE audited module: single-decode → Unicode NFC normalise →
  `path.resolve(base, untrusted)` → `path.relative` containment assertion →
  `fs.realpath` symlink canonicalisation → re-assert at rename with `O_NOFOLLOW`.
- **Why allowed:** no containment library is currently vetted. `pillarjs/resolve-path`
  exists but omits symlink canonicalisation, which AD-6 requires to close the
  realpath→rename TOCTOU window. Adopting a half-covering library would be worse
  than one fully-audited module.
- **This is NOT hand-rolling-by-default:** it is a deliberate centralisation into
  a single audited primitive, not scattered per-call checks.
- **Signed off:** operator, 2026-06-23 (architecture spine operator-decisions
  table — "Containment-library deviation (AD-6) — SIGNED OFF").
- **Mitigation:** (1) centralised in one module with one code path; (2) covered
  by an explicit path-traversal test battery (AD-6); (3) re-asserted at rename
  with `O_NOFOLLOW`; (4) recorded here and in `docs/primitive-allowlist.md` as the
  documented exception so the deviation is visible, not silent.
- **Review trigger:** re-evaluate when a vetted library that covers decode +
  normalise + resolve + relative-containment + `realpath` + `O_NOFOLLOW` re-check
  emerges. If adopted, retire this entry with a dated supersede note.

---

<!-- Append new AP-n entries below this line. -->
