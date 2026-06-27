# Darkroom

Local-first dashboard to **manage photo galleries and batch‑edit or generate images with AI** — for free through ChatGPT's web app (no API costs), or through Higgsfield. It indexes a folder of originals, keeps multiple versions per photo, lets you craft prompts visually, mark favorites, and export the final set. A built‑in MCP server lets you drive the whole thing from Claude.

> Darkroom started as a tool to finish post‑production on a few hundred travel photos without paying per‑image API fees. It edits images by automating the same ChatGPT web app you already pay for as a human.

## Features

- **Gallery management** — index a folder of originals, browse a grid, filter by state (no versions / no favorite / with favorite).
- **Batch editing** — queue every photo with one click; the worker runs them one at a time in the background.
- **Generate from scratch** — text‑to‑image with no source photo; results land in the gallery like any other item.
- **Versioning** — every render is a numbered version with the exact prompt + settings used; pick a favorite per photo.
- **Visual prompt builder** — compose looks from labeled controls (film stock, time of day, bloom, skin tones…) with on‑disk previews.
- **Pluggable backends** — ChatGPT web (default, free), Codex CLI, or Higgsfield (optional, paid).
- **MCP server** — list galleries, enqueue edits/generations, check jobs, set favorites, export — all from Claude.
- **Export** — copy all favorites into a clean `final/` folder.

## Stack

- **Backend** — [Bun](https://bun.sh) + [Hono](https://hono.dev) + `bun:sqlite` (port 3535)
- **Frontend** — Vite + React 19 + Tailwind v4 (port 5173, proxied to the backend)
- **Worker** — a Python subprocess (`scripts/edit_batch.py`) that talks to a dedicated Chrome over CDP, or the Codex CLI, or the Higgsfield HTTP API

## Requirements

1. **Bun** ≥ 1.3 — `brew install oven-sh/bun/bun` (or see bun.sh)
2. **Python 3** with `websockets` — for the ChatGPT‑web backend: `pip install websockets`
3. **Google Chrome / Chromium** — only for the ChatGPT‑web backend. Darkroom launches a dedicated instance with its own profile; you log in to chatgpt.com once and it persists.

## Setup

```bash
git clone https://github.com/zorahrel/darkroom
cd darkroom
bun install
cp .env.example .env          # optional — defaults store everything under ~/Darkroom

bun run db:init               # create schema + seed the global prompt
# put your originals in ~/Darkroom/data/RAW/ (or set GALLERY_RAW_DIR)
bun run import                # index originals
bun run server/cli.ts stats   # see what's in the DB
```

Everything Darkroom stores lives under `GALLERY_ROOT` (default `~/Darkroom`). Nothing is hardcoded — see [`server/config.ts`](server/config.ts) and `.env.example`.

## Run

```bash
bun run dev                   # backend + frontend, auto-picks free ports
# or separately:
PORT=3535 bun run server
bun run client
```

Open the URL printed by `bun run dev` (default http://localhost:5173).

## Workflow

1. **Pick a backend.** Default is ChatGPT web. On first use, click the “Browser offline” banner (or `POST /api/browser/launch`) — a dedicated Chrome opens; log in to chatgpt.com once.
2. **Grid** — filter “No versions” and click **Generate missing** to queue every unedited photo with the current prompt.
3. **Generate from scratch** — open the Generate panel, type a prompt and a count; new items appear in the gallery.
4. **Photo detail** (`/photo/:id`) — original on the left, render carousel on the right.
   - `←/→` switch version · `F` favorite · `G` new render · `[`/`]` prev/next photo
   - Tune the per‑photo prompt and **Save override** when the global look isn't enough. Each version records the exact prompt used.
5. **Export favorites** — copies every favorite into `<root>/data/final/<photo_id>.png`.

## Backends

| Backend | Cost | Setup |
|---|---|---|
| **ChatGPT web (CDP)** — default | Free (uses your ChatGPT plan) | Chrome + one‑time login |
| **Codex CLI** | Per your Codex plan | `WORKER_BACKEND=codex`, `CODEX_BIN=…` |
| **Higgsfield** | Paid (credits) | Complete the OAuth flow, or `HIGGSFIELD_ENABLED=1` |

Select with `WORKER_BACKEND=cdp|codex`. Higgsfield runs alongside as a per‑job choice and is **off unless** a token file exists or `HIGGSFIELD_ENABLED=1`. None of these are affiliated with Darkroom — you bring your own account.

## MCP server (drive Darkroom from Claude)

Darkroom ships an MCP server that wraps the local API. Start the backend, then register the server:

```jsonc
// ~/.claude.json  (or your MCP client config)
{
  "mcpServers": {
    "darkroom": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/darkroom/mcp/server.ts"],
      "env": { "DARKROOM_API": "http://localhost:3535" }
    }
  }
}
```

Tools exposed: `list_photos`, `get_photo`, `edit_photo`, `generate_image`, `list_jobs`, `set_favorite`, `set_global_prompt`, `export_favorites`. See [`mcp/README.md`](mcp/README.md).

## API

| Verb | Path | Description |
|---|---|---|
| GET | `/api/health` | Backend + ChatGPT browser status |
| POST | `/api/browser/launch` | Launch the dedicated Chrome (CDP) |
| GET | `/api/photos?filter=all\|no_versions\|no_favorite\|with_favorite` | Gallery grid |
| GET | `/api/photos/:id` | Photo + versions + effective prompt |
| PUT | `/api/photos/:id/favorite` | `{version_id\|null}` |
| PUT | `/api/photos/:id/prompt` | `{prompt: string\|null}` (null reverts to global) |
| DELETE | `/api/photos/:id/versions/:vid` | Remove a version (never the original) |
| POST | `/api/photos/:id/generate` | Enqueue one edit job |
| POST | `/api/generate-missing` | Enqueue every photo with 0 versions |
| POST | `/api/generate-new` | Generate a brand‑new image from a prompt |
| GET/PUT | `/api/settings/global-prompt` | Global prompt |
| GET | `/api/jobs` | Queue snapshot |
| POST | `/api/export-favorites` | Copy favorites into `final/` |

## Configuration

All settings are environment variables with sane defaults — see [`.env.example`](.env.example). Highlights:

- `GALLERY_ROOT` — where data + DB live (default `~/Darkroom`)
- `PORT` — backend port (default 3535)
- `WORKER_BACKEND` — `cdp` (default) or `codex`
- `CHROME_BIN` — override Chrome auto‑detection
- `CHATGPT_CDP_PORT` — debugging port for the dedicated Chrome (default 19223)

## Troubleshooting

- **“Browser offline” banner** — click it, or `curl -X POST http://localhost:3535/api/browser/launch`. Log in to chatgpt.com in the window that opens.
- **Jobs stuck `failed`** — click the photo id in the Jobs panel for the error. The Python worker saves a screenshot to `logs/fail_*.png` when the page breaks.
- **Session expired (~7 days)** — if several jobs time out in a row, log in again in the dedicated Chrome window.
- **Throughput** — the queue runs one job at a time. A few hundred photos at ~60s each is a multi‑hour batch; leave it running.

## How it works

Darkroom never reverse‑engineers any private API. The ChatGPT‑web backend automates the public web app over the Chrome DevTools Protocol: it opens a new chat, uploads (or skips, for generation), sends your prompt, waits for the rendered image, and downloads it — exactly the steps a human would take. You are responsible for using it within the terms of whatever account you connect.

## License

MIT — see [LICENSE](LICENSE).
