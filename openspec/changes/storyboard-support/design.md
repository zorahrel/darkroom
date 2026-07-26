## Context

Letto dal codice reale (non assunto):

- **Darkroom**: Bun + Hono + `bun:sqlite` (porta 3535) + Vite/React 19 (5173). Multi-progetto
  "Studio" già esistente in `server/project.ts`: ogni progetto è una cartella con propria
  SQLite (`photos.db`) + `data/{RAW,TEST1,generations,final,graded,uploads}`, registrata in
  `~/Darkroom/projects.json`, risolta via `AsyncLocalStorage` (`withProject`/`currentProjectId`,
  `dirsFor(pid)`). Un progetto "storyboard" può essere semplicemente un altro `Project` di
  questo registro — **nessuna nuova astrazione di progetto**, si riusa quella esistente.
- **Schema** (`server/db.ts`): tabelle `photos`, `versions`, `settings`, `jobs`, `orphans`,
  `presets`. Migrazioni idempotenti nel pattern `hasColumn(d, table, col)` + guarded
  `ALTER TABLE ... ADD COLUMN`, eseguite ad ogni apertura DB dentro `initSchemaOn()` — **non
  un migration tool separato**, è il pattern stabilito (`config_override`, `taken_at`,
  `grade_override`, `kind`, `input_path` sono tutti arrivati così).
  `photos` ha già: `id`, `original_path`, `favorite_version_id`, `custom_prompt`,
  `config_override` (TEXT/JSON), `kind` ('original'|'generated'), `taken_at`,
  `extra_instructions`, `grade_override` (TEXT/JSON), `feedback`. `jobs` ha `input_path` (già
  usato per il chaining multi-pass del bake) e `mode` ('edit'|'generate').
- **MCP** (`mcp/server.ts`): stdio wrapper sottile su REST locale (`DARKROOM_API`, default
  `:3535`). 10 tool esistenti (`list_photos`, `get_photo`, `edit_photo`, `generate_image`,
  `generate_missing`, `list_jobs`, `set_favorite`, `set_global_prompt`, `export_favorites`,
  `status`), ognuno `{name, description, inputSchema, handler}` che chiama un endpoint REST.
- **Worker** (`server/worker.ts` + `scripts/edit_batch.py`): CDP verso un Chrome dedicato
  loggato su chatgpt.com. `upload_file(cdp, file_path)` (riga 163 di `edit_batch.py`) allega
  **un** file per chiamata, e `process_one`/`single_shot` chiamano `upload_file` **una sola
  volta** per job prima di `send_prompt`. **Spike risolto**: oggi il worker NON supporta upload
  multi-immagine in un solo turno — è un gap reale, non un'assunzione, vedi D3 sotto.
- **Storyboarder** (`.storyboarder` file, da `src/js/models/board.js`/`scene.js` reali):
  `scene = { boards: [...], defaultBoardTiming }`, `board = { uid, url, duration?, time
  (calcolato), newShot, layers? (omissibile), audio?, link?, sg? }`. **Spike CHIUSO
  (2026-07-26)**: l'involucro top-level è stato confermato scaricando tre `.storyboarder`
  reali dai fixture del repo (`test/fixtures/{example,ducks,shot-generator}`) invece di
  dedurlo dal sorgente — `{ version: "2.0.1", aspectRatio: 1.7777…, fps: 24,
  defaultBoardTiming: 2000, boards: [...] }`, con le immagini in `images/` accanto al file e
  naming `board-<number>-<uid>.png`. Ogni board porta anche `number`, `shot` ("1A"),
  `lastEdited` e `lineMileage` (metrica di disegno: 0 per i pannelli generati da noi).

## Decisions

### D1 — Storyboard = tipo di progetto Darkroom, non nuova astrazione

Un progetto storyboard è un `Project` normale (`server/project.ts`) con una foto = un
pannello. Non serve un modello dati parallelo: si riusano `photos`/`versions`/`jobs` così
com'è la generazione, il favorite-versioning, il bake multi-pass e il job queue. La sola
differenza è che questo progetto ha *ordine* e *durata* sui suoi pannelli, e opzionalmente
*personaggi*.
Alternativa scartata: tabella `storyboards` separata con proprie foreign key verso `photos`
— più flessibile in teoria ma duplica ciò che `project.ts` già risolve (isolamento dati,
cartelle, registro), contro la direttiva di riuso.

### D2 — Timeline: 3 colonne su `photos`, mirror diretto di `board.duration`/`.time`

```sql
ALTER TABLE photos ADD COLUMN sequence_index INTEGER;   -- ordine pannello nel progetto
ALTER TABLE photos ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 3000;  -- board.duration
ALTER TABLE photos ADD COLUMN scene_label TEXT;          -- opzionale, board.newShot/etichetta
```
`sequence_index NULL` = foto non ancora in una sequenza (comportamento identico a un progetto
foto normale — retrocompatibile, nessuna migrazione dati richiesta). `duration_ms` di default
3000 mirror-a il `defaultBoardTiming` di Storyboarder (che è tipicamente ~3s/board). Niente
colonna `time` cumulativa: si calcola a runtime (in `storyboardExport.ts` e in un futuro
endpoint di preview), esattamente come fa Storyboarder stesso via `sceneDuration()` — evita
di dover tenere una colonna derivata sincronizzata ad ogni riordino.
Alternativa scartata: tabella `sequences` con proprie righe ordinate — over-engineering per
quello che è, nella pratica, un intero (`ORDER BY sequence_index`) e un intero (durata).

### D3 — Pin Characters: tabella `characters` + `photos.character_ids`, upload multi-immagine ESPLICITAMENTE fuori scope v1

```sql
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  reference_photo_id TEXT REFERENCES photos(id),
  description TEXT,
  created_at INTEGER NOT NULL
);
ALTER TABLE photos ADD COLUMN character_ids TEXT;  -- JSON array, pattern già usato da config/provider_params/grade_override
```
**Spike RI-APERTO e chiuso in positivo (2026-07-26)**: la prima lettura concludeva che
servissero N chiamate sequenziali a `upload_file` (o un collage PIL di fallback). Rileggendo
il codice: `upload_file` termina con `DOM.setFileInputFiles({ files: [file_path], ... })` —
il protocollo CDP accetta già **un array** di file, e ne passiamo uno solo per come è scritta
la funzione, non per un limite tecnico. Allegare la reference del personaggio insieme allo
sketch del pannello costa quindi un parametro, non un nuovo meccanismo: `upload_file(cdp,
paths: list[str])` con una sola `setFileInputFiles`, e l'attesa thumbnail estesa a N
allegati. Il collage viene **scartato** (degrada la reference e confonde il modello sul
soggetto da editare).

Di conseguenza lo scope approvato include il collegamento reale personaggio→generazione
(Phase 5 di `tasks.md`), non solo la modellazione dati. L'unico vincolo che resta è di
robustezza, non di fattibilità: se l'attesa delle N thumbnail nel composer scade, il job
**non fallisce** — riparte con il solo input primario, perché un pannello generato senza
reference è infinitamente meglio di un job morto in coda.

### D4 — Export `.storyboarder`: nuovo modulo, non tocca lo schema jobs/versions

`server/storyboardExport.ts`, funzione `exportStoryboard(pid: string): Promise<{ path: string
}>`. Legge le foto del progetto attivo con `sequence_index NOT NULL`, ordina, per ognuna
risolve il path immagine reale (`favorite_version_id` → file versione, fallback
`original_path` se nessun favorite), copia in `<export>/images/board-N-<uid>.png`, scrive
`<export>/<project-name>.storyboarder` con `{ boards: [...], defaultBoardTiming }` più
l'involucro top-level confermato dallo spike 0.1 (vedi Context). L'export vive
sotto la cartella `final/` esistente del progetto (`dirsFor(pid).FINAL_DIR/storyboard/`),
riusando i path già gestiti da `project.ts` invece di inventare una nuova convenzione di
cartelle.
Alternativa scartata: generare il file lato client (React) — l'accesso ai path assoluti delle
versioni e ai file immagine è già lato server, spostarlo al client aggiungerebbe un giro HTTP
inutile per ogni immagine.

### D5 — MCP: due tool nuovi, stesso pattern esistente

- `export_storyboard` — `{ }` → `POST /api/storyboard/export`, ritorna il path del file
  scritto. Nessun parametro obbligatorio: opera sul progetto attivo (stesso modello di
  `export_favorites`).
- `set_sequence` — `{ ids: string[] }` → `PUT /api/storyboard/sequence`, riscrive
  `sequence_index` di ogni foto secondo l'ordine dell'array (0-based). Scelto un endpoint
  bulk (array ordinato) invece di un `set_sequence_index` per singola foto, perché il caso
  d'uso reale via chat ("riordina questi pannelli così") è quasi sempre un riordino
  complessivo, non un singolo spostamento — evita N chiamate MCP per un riordino.
Nessun tool per `characters` in v1 (CRUD minimo, si può fare via un futuro
`set_character`/`list_characters` quando D3 viene sbloccato — non necessario solo per
modellare i dati).

## Performance / Ottimizzazione (richiesta esplicita)

Valutazione dell'architettura Darkroom esistente alla luce di questa nuova feature — non è
il progetto generale di riordino Mac, è specifico a Darkroom:

- **Query pattern**: `list_photos`/l'endpoint sequence useranno `ORDER BY sequence_index`.
  Verificare se `photos` ha un indice su questa colonna prima di assumerne l'efficienza —
  con volumi da storyboard (decine-centinaia di pannelli per progetto, non le migliaia di
  foto di un progetto fotografico) un indice è probabilmente overkill, ma va confermato
  leggendo `db.ts` per indici esistenti su `photos` prima di aggiungerne uno gratuitamente.
- **Job queue**: il riordino (`set_sequence`) NON deve accodare job — è una scrittura DB pura,
  zero interazione col worker CDP. Va verificato che l'endpoint non triggeri accidentalmente
  `generate`/`edit` (rischio di riusare codice esistente con side-effect impliciti).
- **I/O export**: `exportStoryboard` copia N immagini favorite in `images/`. Per progetti
  storyboard tipici (10-50 pannelli) è I/O trascurabile; per progetti più grandi va valutato
  se copiare per-file in loop sincrono blocca l'event loop Bun abbastanza da giustificare un
  batch/stream — da profilare quando implementato, non da pre-ottimizzare ora.
- **Isolamento multi-progetto**: `AsyncLocalStorage` già garantisce che due export/riordini
  concorrenti su progetti diversi non si pestino i piedi; nessun cambio necessario. L'unico
  rischio è un export lanciato mentre il worker sta scrivendo una nuova versione per lo stesso
  progetto — mitigato acquisendo lo stesso lock di `acquireBrowserLock` non serve (l'export
  legge solo file già scritti), ma va verificato che `favorite_version_id` non punti a una
  versione "in corso" (job `running`) — l'export dovrebbe leggere solo versioni con job
  `done`.

Questa sezione è una valutazione, non un elenco di ottimizzazioni da fare subito: nessuna di
queste è un blocco all'approvazione, sono punti da verificare/misurare durante
l'implementazione (Fase 4 di `tasks.md`).

## Verifica (quando si implementa)

- Unit (`bun:test`): `hasColumn`/migrazione nuove colonne su DB esistente (idempotenza:
  riapertura non duplica `ALTER TABLE`); `exportStoryboard` su un progetto fixture con 3
  pannelli → file `.storyboarder` valido JSON + 3 file in `images/`; `set_sequence` riscrive
  gli indici nell'ordine dato.
  Placeholder: `tests/e2e/` non esiste ancora in questo repo (verificato, nessuna cartella
  test) — per il codice server puro sono sufficienti unit `bun:test`, coerente con quanto già
  presente nel resto del repo prima di introdurre Playwright solo per questa feature.
- Manuale: aprire il file `.storyboarder` esportato dentro Storyboarder vero (installato via
  `brew install --cask storyboarder`) e confermare che i pannelli/durate sono corretti prima
  di considerare l'export "fatto".
