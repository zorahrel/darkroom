## Why

[directorscantdraw.com](https://directorscantdraw.com/) è uno strumento AI di storyboarding
per filmmaker ("Transform rough sketches into professional storyboard panels with AI") ma è
**closed source** (hosted su `directorscantdraw.lovable.app`, v4.3, nessun repo pubblico).

L'alternativa OSS top di categoria è **Storyboarder** (github.com/wonderunit/storyboarder,
Electron): copre molto bene il disegno manuale e — sorpresa positiva — il suo "Shot
Generator" 3D (mannequin posabili, camera blocking) replica quasi 1:1 tre delle feature di
directorscantdraw.com. Ma è **zero-AI**: nessuna generazione, nessun redraw assistito, nessun
MCP/API — puro tool GUI desktop. Licenza: informale (nessuna SPDX license nel repo; l'intento
dichiarato dall'autore in un post del blog è "MIT-like con eccezioni", mai formalizzato — non
un vero grant open source, ma abbastanza aperto per generare/leggere il suo formato file
`.storyboarder` per uso personale non ridistribuito, che è tutto ciò che serve qui).

**Darkroom** (questo repo) ha già tutto ciò che a Storyboarder manca: generazione AI gratuita
via ChatGPT web (CDP), versioning, un MCP server pilotabile da Claude, un job queue con
chaining multi-pass, e un'architettura multi-progetto ("Studio") pronta a ospitare un nuovo
tipo di progetto. Il gap non è "quale tool scegliere" — è **collegare i due**: Darkroom fa la
parte AI/orchestrazione via chat naturale ("raccontami la storia, preparami lo storyboard"),
Storyboarder fa la parte 3D/print/playback nativa che non ha senso reimplementare.

## What Changes

Aggiungere a Darkroom il supporto per progetti "storyboard": un ordinamento sequenziale dei
pannelli con durata (timeline), personaggi con immagine di riferimento (per coerenza
cross-panel), ed **export** verso il formato file nativo di Storyboarder (`.storyboarder` +
`images/`), così l'utente può orchestrare tutto via MCP/chat in Darkroom e poi aprire il
risultato in Storyboarder per rifinire a mano, blocking 3D, e stampa/PDF.

Mappatura delle 9 feature di directorscantdraw.com (dettaglio in `design.md`):

| # | Feature | Dove |
|---|---|---|
| 1 | Draw + AI enhance sketch | **Darkroom** (riuso `jobs.input_path`) |
| 2,6,7 | 3D blocking / mannequin posabile / rotazione camera | **Storyboarder nativo** (delega) |
| 3 | Storyboard A4/PDF print-ready | **Storyboarder nativo** (delega) |
| 4 | Timeline/beat/durata | **Darkroom** (nuovi campi, mirror di `board.duration`/`.time`) |
| 5 | Pin Characters (coerenza cross-panel) | **Darkroom** (nuova tabella `characters`) |
| 8 | Generative Lasso (redraw mascherato) | **Fuori scope** — spike separato, alto rischio |
| 9 | Share + link/PIN | **Fuori scope** — Darkroom è local-first, no hosting |

**Non-goal:** nessuna reimplementazione del motore 3D di Storyboarder in Darkroom; nessun
controllo live/remoto di Storyboarder (non esiste API, solo file); nessun mascheramento
AI-assistito in questa fase (feature 8, valutata rischiosa/incerta via CDP); nessuna
condivisione hosted (feature 9).

## Impact

- **Schema DB** (`server/db.ts`): 3 nuove colonne su `photos`, 1 nuova tabella `characters`,
  seguendo il pattern di migrazione idempotente già in uso (`hasColumn` + `ALTER TABLE`).
- **Nuovo modulo**: `server/storyboardExport.ts` (scrittura file `.storyboarder` + `images/`).
- **MCP** (`mcp/server.ts`): 1-2 nuovi tool (`export_storyboard`, `set_sequence`).
- **Nessuna rottura**: additivo, un progetto Darkroom "normale" (foto singole, non-storyboard)
  non è toccato — le nuove colonne sono opzionali/NULL-default.
- Include una sezione di valutazione performance/ottimizzazione dell'architettura Darkroom
  esistente alla luce di questa nuova feature (vedi `design.md` § Performance).

**Stato:** proposta scritta per revisione. **Nessun codice è stato scritto.** Si implementa
in una sessione futura dopo approvazione esplicita.
