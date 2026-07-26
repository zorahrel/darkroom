# Contributing to Darkroom

Thanks for your interest! Darkroom is a local-first tool, so most development
happens against your own gallery.

## Setup

```bash
bun install
cp .env.example .env       # optional — defaults store data under ~/Darkroom
bun run db:init
bun run dev                # backend + frontend with hot reload
```

## Before opening a PR

```bash
bun run typecheck          # must pass
bun test                   # must pass
bun run build:client       # must succeed
```

Tests live in `tests/` and run on `bun:test`. They are hermetic: `tests/setup.ts`
(preloaded via `bunfig.toml`) points `GALLERY_ROOT`, the project registry and the
DB at a fresh temp dir, so no test can read or write a real gallery. The DB tests
also migrate a *copy* of your local `photos.db` when there is one, which is the
guard that a schema change can't lose a row.

- Keep changes focused; one concern per PR.
- Match the surrounding code style (TypeScript, no semicolon-free reformatting).
- New configuration must be env-driven via `server/config.ts` — never hardcode
  machine-specific paths.
- Don't commit anything under `data/`, any `*.db`, `.env`, or provider tokens
  (`higgsfield.json`). The `.gitignore` already blocks these; double-check.

## Architecture (quick map)

| Path | What |
|---|---|
| `server/config.ts` | Single source of truth for paths/ports/providers (env-driven) |
| `server/db.ts` | SQLite schema + row types |
| `server/app.ts` | Hono app: middleware + route mounting |
| `server/index.ts` | Boot (port, job runner) |
| `server/routes/*.ts` | The HTTP API, one module per area |
| `server/verify.ts` | Quality checks: failure-mode catalogue, gate, suggestions |
| `server/storyboard.ts` | Panels, cast, beat sheet → queued panels |
| `server/storyboardExport.ts` | Export to Storyboarder's native format |
| `server/jobs.ts` | Job queue + provider dispatch |
| `server/worker.ts` | ChatGPT-web (CDP) backend |
| `server/worker-codex.ts` | Codex CLI backend |
| `server/higgsfield.ts` | Higgsfield backend (optional) |
| `scripts/edit_batch.py` | Python CDP driver for ChatGPT web |
| `client/` | React + Vite UI |
| `tests/` | bun:test suite (schema, prompt, grade, API, storyboard) |
| `mcp/` | MCP server exposing the API to Claude |

## Adding a backend (provider)

A provider turns a prompt (+ optional source image) into an output PNG. See
`server/jobs.ts` for how `chatgpt` and `higgsfield` are dispatched, and mirror
that shape. Gate anything paid behind an env flag and document it in
`.env.example`.
