# Folio

Folio is the project working name (see `_bmad-output/` for design context). The
repository is a monorepo of independently-buildable workspaces:

- `relay/` — Cloudflare Worker (MCP transport, edge guard, durable-object broker)
- `puller/` — Node 24 service (sole filesystem writer; outbound channel)
- `shared/` — cross-workspace libraries (e.g. `frame-protocol`)
- `tests/` — repo-level acceptance tests (vitest)
- `hooks/`, `scripts/`, `docs/` — dev-workflow tooling and standards

## First-run setup

After cloning, install the versioned pre-commit hook (makes `main` physically
uncommittable — direct commits to `main` are rejected):

```bash
npm run setup
```

This runs `git config core.hooksPath <root>/hooks`. It is idempotent — safe to
re-run. See [`docs/contributing.md`](docs/contributing.md) for the full worktree +
branch workflow and the per-worktree dev-environment isolation scheme.

## Common scripts (run from the repo root)

| Script          | What it does                                                              |
| --------------- | ------------------------------------------------------------------------- |
| `npm run setup` | Activate the versioned pre-commit hook (do this once after clone).        |
| `npm run dev`   | Launch the relay + puller in an isolated per-worktree dev environment.    |
| `npm test`      | Run the repo-level vitest suite (acceptance + guardrail tests).           |
| `npm run check` | Type-check the repo-level TypeScript (`tsc --noEmit`).                    |

> **Never commit directly to `main`.** Start every unit of work on its own branch
> (convention: `story/bmad-<epic>-<story>-<slug>`) and merge via pull request. The
> pre-commit hook enforces this locally; see `docs/contributing.md`.
