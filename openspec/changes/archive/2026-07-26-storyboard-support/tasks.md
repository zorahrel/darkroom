# Tasks — storyboard-support

Convenzione: `[ ]` da fare, `[x]` fatto+verificato.

**Stato: approvato il 2026-07-26 con scope allargato** rispetto alla proposal
originale, su quattro decisioni esplicite:

1. **UI piena** — non solo backend+MCP: una route `/storyboard` con pannelli riordinabili,
   durate, personaggi e generazione da beat sheet.
2. **Personaggi collegati davvero alla generazione** — non solo modellazione dati (lo spike
   0.3 si è chiuso in positivo, vedi sotto).
3. **Hardening full server + client** — suite di test da zero, split di `server/index.ts`,
   `Detail.tsx` e `api.ts`.
4. Il progetto **Japan** (190 foto, 1647 versioni) deve restare intatto e funzionante.

## Phase 0 — Spike (CHIUSI il 2026-07-26, prima di scrivere codice)

- [x] 0.1 Involucro top-level `.storyboarder` — **confermato** da tre fixture reali del repo
  Storyboarder (`test/fixtures/{example,ducks,shot-generator}`), non assunto:
  `{ version: "2.0.1", aspectRatio: 1.7777…, fps: 24, defaultBoardTiming: 2000, boards: [...] }`.
  Board: `{ uid, url, newShot, lastEdited, number, shot, time, duration?, lineMileage,
  layers?, notes?, audio?, link? }`. Le immagini vivono in `images/` accanto al file, con
  naming `board-<number>-<uid>.png` (+ `-thumbnail`, `-reference`, `-notes`, `-fill`
  opzionali). `duration` è per-board e omessa quando vale il `defaultBoardTiming`; `time` è
  l'offset cumulativo in ms.
- [x] 0.2 Indici su `photos` — **nessun indice esiste** (solo `idx_versions_photo` e
  `idx_jobs_status`). Le query di galleria fanno `ORDER BY taken_at/created_at` su tabella
  piena: gli indici vanno aggiunti in Phase 2 insieme a quello su `sequence_index`.
- [x] 0.3 Upload multi-immagine via CDP — **fattibile**: `DOM.setFileInputFiles` accetta già
  un array `files`, e `upload_file` in `edit_batch.py` ne passa uno solo per scelta, non per
  limite del protocollo. Il collage di fallback (ipotesi B di D3) **non serve**. Sblocca il
  collegamento reale personaggio→generazione (Phase 5).

## Phase 1 — Fondamenta di solidità (PRIMA del refactor: è la rete di sicurezza)
- [x] 1.1 `tests/` con `bun:test` — il repo non aveva alcun test
- [x] 1.2 Test: idempotenza migrazioni `db.ts` su DB esistente (riapertura non duplica)
- [x] 1.3 Test: `assemblePrompt`/`mergeConfig` (promptConfig.ts)
- [x] 1.4 Test: `sanitizeSteps`/`normalizeGrade` (grade, whitelist step)
- [x] 1.5 Script `test` in package.json + step `bun test` in `.github/workflows/ci.yml`

## Phase 2 — Schema (server/db.ts, pattern hasColumn esistente)
- [x] 2.1 `photos.sequence_index INTEGER`
- [x] 2.2 `photos.duration_ms INTEGER NOT NULL DEFAULT 3000`
- [x] 2.3 `photos.scene_label TEXT`
- [x] 2.4 `photos.character_ids TEXT` (JSON array)
- [x] 2.5 `CREATE TABLE characters (id, name, reference_photo_id, description, created_at)`
- [x] 2.6 Indici mancanti (esito 0.2): `photos(sequence_index)`, più quelli che il profiling
  delle query di galleria mostra necessari
- [x] 2.7 `PhotoRow` aggiornato + test di idempotenza verde su copia del DB Japan

## Phase 3 — Backend storyboard
- [x] 3.1 `server/storyboard.ts`: sequence bulk, CRUD `characters`, creazione pannelli da
  beat sheet (riusa il percorso `generate` esistente, niente motore nuovo)
- [x] 3.2 `server/storyboardExport.ts`: `exportStoryboard(pid)` → `.storyboarder` + `images/`
  sotto `dirsFor(pid).FINAL_DIR/storyboard/`, involucro confermato in 0.1
- [x] 3.3 Risoluzione immagine per pannello: favorite version (job `done`) → ultima `done` →
  `original_path`
- [x] 3.4 Route REST `/api/storyboard/*`
- [x] 3.5 Test: progetto fixture 3 pannelli → JSON valido, `time` cumulativo corretto,
  3 immagini copiate

## Phase 4 — Split server/index.ts (1371 righe → moduli route)
- [x] 4.1 `server/routes/*.ts` montati su Hono, `index.ts` ridotto a bootstrap+middleware
- [x] 4.2 Refactor a comportamento invariato: test di Phase 1/3 verdi prima e dopo

## Phase 5 — Personaggi nella generazione (sbloccata da 0.3)
- [x] 5.1 `upload_file` accetta N path (un solo `DOM.setFileInputFiles`), attesa di N thumb
- [x] 5.2 `jobs.ref_paths` (JSON) propagata dalla API al worker
- [x] 5.3 Prompt che nomina i personaggi allegati (coerenza cross-panel)
- [x] 5.4 Fallback: se l'attesa thumb fallisce, genera col solo input primario (mai bloccare)

## Phase 6 — Client
- [x] 6.1 Route `/storyboard` lazy-loaded: pannelli riordinabili, durata, etichetta scena
- [x] 6.2 Pannello personaggi (crea da foto, pinna sul board)
- [x] 6.3 Generazione pannelli da beat sheet + bottone Export
- [x] 6.4 Split `Detail.tsx` (1196) e `api.ts` (727) senza cambi funzionali

## Phase 7 — MCP (mcp/server.ts)
- [x] 7.1 `set_sequence({ids})`
- [x] 7.2 `export_storyboard({})`
- [x] 7.3 `create_panels({beats})`
- [x] 7.4 `list_characters` / `set_character`

## Phase 8 — Verifica end-to-end (eseguita il 2026-07-26)
- [x] 8.1 typecheck + `bun test` + build client verdi
- [x] 8.2 App avviata sulla :3737 reale: griglia Japan intatta (190 foto · 189 con almeno
  una versione · 21 con preferita), editor foto aperto senza errori in console
- [x] 8.3 Flusso reale nella UI: 3 foto portate nel board, riordino drag&drop verificato,
  export → `.storyboarder` + 3 PNG; involucro confrontato campo per campo col fixture
  `example.storyboarder` di Storyboarder (identico). Board poi svuotato: Japan com'era.
- [x] 8.4 Conteggi DB pre/post identici: photos 190, versions 1647, jobs 104, orphans 130,
  21 preferite, 0 pannelli residui
- [x] 8.5 README/CONTRIBUTING aggiornati

## Non fare in questa change (invariato)
- Generative Lasso / redraw mascherato
- Share + link/PIN hosted
- Reimplementazione 3D blocking/mannequin/camera in Darkroom

## Verifica MCP (2026-07-26)

`bun mcp/server.ts` contro il backend vero: `initialize` ok, 17 tool esposti (7 storyboard),
`list_storyboard` e `list_characters` rispondono sul progetto attivo.
