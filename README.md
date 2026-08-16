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
- **Local color grade** — one uniform look for the whole set (3D `.cube` LUT + robust AWB + pink pop), previewed live in the grid and baked into the full‑res export. Drop your LUTs in `data/luts/`.
- **Pipeline & run browser** — run the whole chain (regenerate favorites → color grade → promote → export) as one action, and filter the grid by generation batch ("run") from a dropdown.
- **Pick (♥)** — one click on a grid tile marks a photo as a keeper. Deliberately separate from the favorite star (which picks *which render* of a photo is the good one) and from collections: first you say what is worth keeping, then you group. Filter the grid by "Mi piace" / "Da guardare" to work through the set.
- **Collections (posts)** — group the gallery into the units you actually publish: each collection is an ordered subset (a post or carousel) with a title and a caption. Group the grid by "Post", assign a selection in bulk, rename or dissolve a post from its header, and filter by "Non assegnate" to work through what is not published yet. Membership is exclusive, so a photo can't silently go out twice.
- **Export** — copy all favorites into a clean `final/` folder (graded full‑res JPGs when the grade is on).
- **Quality checks** — measure every render against a catalogue of known failure modes: free pixel checks (blown highlights, crushed blacks, near-duplicate re-renders) plus yes/no questions for a local vision model (garbled signage, deformed anatomy, watermarks). The gate flags and suggests a favourite; it never deletes or promotes on its own. What it keeps catching can be turned into a clause in the prompt's "Do not" block.
- **Storyboard** — turn a beat sheet into ordered panels (one generation each), give them durations, scene labels and a pinned cast whose reference images ride along with every generation, then export to [Storyboarder](https://github.com/wonderunit/storyboarder)'s native format for 3D blocking and print.

## Stack

- **Backend** — [Bun](https://bun.sh) + [Hono](https://hono.dev) + `bun:sqlite` (port 3535)
- **Frontend** — Vite + React 19 + Tailwind v4 (port 5173, proxied to the backend)
- **Worker** — a Python subprocess (`scripts/edit_batch.py`) that talks to a dedicated Chrome over CDP, or the Codex CLI, or the Higgsfield HTTP API

## Requirements

1. **Bun** ≥ 1.3 — `brew install oven-sh/bun/bun` (or see bun.sh)
2. **Python 3** with `websockets` — for the ChatGPT‑web backend: `pip install websockets`
3. **Google Chrome / Chromium** — only for the ChatGPT‑web backend. Darkroom launches a dedicated instance with its own profile; you log in to chatgpt.com once and it persists.
4. **ffmpeg + Python `numpy`/`Pillow`** — only for the optional local color grade (`scripts/color_grade.py`): `brew install ffmpeg && pip install numpy pillow`.

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

## Projects

Darkroom runs several local projects side by side. A project is a folder with its
own SQLite DB and data dirs; the Studio page is the list of them, and the header
tells you which one you are in.

- **New project** — a name is all you type. The id is derived from it and the
  folder is created under `~/Darkroom/projects/<name>` (override with
  `DARKROOM_PROJECTS_DIR`). "Bring your own folder" is one click away for an
  existing directory.
- **What it's for** — *photo* (a gallery to finish) or *storyboard* (panels in
  sequence). It only decides which views the UI offers: generation, colour grade
  and quality checks are the same pipeline for both, which is the point — a
  storyboard is drawn by the same engine that edits photos.
- **Photos** — point a project at a folder and choose per folder: **link** (index
  the files where they are, nothing copied — the default) or **copy** (bring them
  into the project, for a card or a downloads folder you'll empty). Add more
  folders any time from *Foto del progetto*; "Rileggi" picks up files added since.
- **Removing** — a project can be taken out of the list; its folder, database and
  renders stay on disk. Darkroom never deletes your work.

## Quality checks

Open a photo, then the **Qualità** panel in the pipeline dock (or drive it from
Claude). Two kinds of check:

- **pixel** — histogram and perceptual-hash measurements. Free, instant, need only
  ffmpeg: blown highlights, crushed blacks, and re-renders that came out nearly
  identical to a sibling.
- **vision** — a yes/no question put to a local vision model (the
  [Moondream](https://moondream.ai) CLI; set `MOONDREAM_BIN` if it is not on PATH)
  for what needs semantics: garbled signage, deformed anatomy, watermarks.

Two rules the gate sticks to: **it reports, it never deletes** — the favourite
stays a human choice, suggested at most — and **an unsure answer counts as a
pass**, because a model that hedges is not evidence of a defect.

The catalogue also feeds generation: every failure mode can carry a negative
clause that joins the prompt's "Do not" block, so what the checks keep catching
becomes what the next render is told to avoid. Add your own with
`POST /api/verify/modes` (or the `add_failure_mode` MCP tool) — a recurring
complaint becomes a check and a prompt clause instead of a note nobody reads.

## Storyboard

A storyboard is an ordinary project whose photos are panels: same versioning, same queue,
plus an order, a duration and an optional cast. Open `/p/:pid/storyboard`.

1. **Write the beats** — one shot per line. Each becomes a panel, appended in order, with its
   generation already queued. Thumbnails fill in as the worker gets to them.
2. **Cast** — create a character with a reference photo. That image is attached to every
   generation the character appears in, which is what keeps the same face across panels.
3. **Board** — drag to re‑order, set per‑panel duration and scene label; the running time is
   shown on each panel. Existing gallery photos can be pulled in too.
4. **Export** — writes `<root>/data/final/storyboard/<project>/<project>.storyboarder` plus an
   `images/` folder, in [Storyboarder](https://github.com/wonderunit/storyboarder)'s native
   format. Open it there for 3D shot blocking, hand‑drawn fixes and print/PDF — the half
   Darkroom deliberately does not reimplement.

Everything above is also drivable from Claude over MCP (`create_panels`, `set_sequence`,
`set_character`, `export_storyboard`), which is the point: describe the story in chat, let the
queue draw it.

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

Tools exposed: `list_photos`, `get_photo`, `edit_photo`, `generate_image`, `list_jobs`, `set_favorite`, `set_global_prompt`, `export_favorites`, plus the storyboard set (`list_storyboard`, `create_panels`, `set_sequence`, `update_panel`, `list_characters`, `set_character`, `export_storyboard`) and the quality set (`check_photo`, `verification_summary`, `list_failure_modes`, `add_failure_mode`). See [`mcp/README.md`](mcp/README.md).

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
| GET | `/api/storyboard` | Panels (in order) + cast + board settings |
| POST | `/api/storyboard/panels` | `{beats: [{description, duration_ms?, scene_label?, character_ids?}]}` |
| PUT | `/api/storyboard/sequence` | `{ids}` → panels 0..N‑1, in that order |
| PATCH | `/api/storyboard/panels/:id` | Duration, scene label, pinned cast |
| POST | `/api/storyboard/characters` | Create/update a character |
| POST | `/api/storyboard/export` | Write the `.storyboarder` file + `images/` |
| GET/POST | `/api/verify/modes` | The failure-mode catalogue |
| POST | `/api/verify/photos/:id` | Check every render of a photo + favourite suggestion |
| POST | `/api/verify/batch` | Background pass over unchecked renders |
| GET | `/api/verify/summary` | What gets flagged, how often, and the trend |
| GET/POST | `/api/studio/projects` | List projects · create one from a name |
| DELETE | `/api/studio/projects/:pid` | Forget a project (files stay) |
| GET/POST | `/api/sources` | Photo folders of the active project (link/copy) |
| POST | `/api/sources/rescan` | Re-read them for new files |

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
