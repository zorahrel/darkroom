## ADDED Requirements

### Requirement: STORY-01 — Un progetto Darkroom può avere pannelli sequenziati con durata

Il sistema SHALL permettere di assegnare a ogni foto di un progetto un `sequence_index`
(ordine) e un `duration_ms` (durata in millisecondi, default 3000), senza richiedere alcuna
migrazione dati per i progetti esistenti (foto con `sequence_index` NULL restano foto
"normali", fuori da qualunque sequenza).

#### Scenario: riordino via MCP
- **GIVEN** un progetto con 3 foto senza sequenza
- **WHEN** viene chiamato il tool MCP `set_sequence` con un array di 3 id in un dato ordine
- **THEN** le 3 foto ricevono `sequence_index` 0, 1, 2 nell'ordine dato
- **AND** una successiva `list_photos` le ritorna ordinabili per `sequence_index`

#### Scenario: progetto non-storyboard non è impattato
- **GIVEN** un progetto fotografico esistente senza mai aver chiamato `set_sequence`
- **WHEN** il DB viene riaperto dopo l'aggiunta delle nuove colonne
- **THEN** tutte le foto hanno `sequence_index` NULL e `duration_ms` 3000 (default)
- **AND** nessun comportamento esistente (galleria, edit, export favoriti) cambia

### Requirement: STORY-02 — Export verso il formato file nativo di Storyboarder

Il sistema SHALL generare, per il progetto attivo, un file `.storyboarder` (JSON) più una
cartella `images/` con un'immagine per pannello, leggibile da Storyboarder senza conversioni
manuali. L'ordine dei pannelli nel file SHALL rispettare `sequence_index`; la durata di ogni
pannello SHALL derivare da `duration_ms`.

#### Scenario: export di un progetto con favoriti
- **GIVEN** un progetto con 3 foto sequenziate, ognuna con una `favorite_version_id` impostata
- **WHEN** viene chiamato `export_storyboard` (via MCP o `POST /api/storyboard/export`)
- **THEN** viene scritto un file `.storyboarder` con 3 board nell'ordine di `sequence_index`
- **AND** la cartella `images/` contiene 3 file immagine, uno per pannello, corrispondenti
  alla versione favorita di ciascuna foto (non all'originale, se un favorito esiste)
- **AND** il file apre correttamente in Storyboarder senza errori di parsing

#### Scenario: pannello senza favorito usa l'originale
- **GIVEN** una foto in sequenza senza mai aver generato/scelto una versione favorita
- **WHEN** si esporta lo storyboard
- **THEN** il pannello usa `original_path` come immagine
- **AND** l'export non fallisce e non salta il pannello

#### Scenario: export esclude versioni non completate
- **GIVEN** una foto in sequenza la cui `favorite_version_id` punta a una versione il cui job
  è ancora `running` (non `done`)
- **WHEN** si esporta lo storyboard
- **THEN** il sistema usa l'ultima versione `done` disponibile (o l'originale se nessuna)
- **AND** non include un file immagine parziale/inesistente

### Requirement: STORY-03 — Personaggi pinnabili per coerenza cross-panel (solo modello dati)

Il sistema SHALL permettere di definire personaggi con nome, immagine di riferimento e
descrizione, e di associare zero o più personaggi a ciascun pannello. Questo requirement
copre **solo la modellazione dati**; il collegamento automatico al job di generazione AI
(far "somigliare" un pannello generato al personaggio pinnato) è esplicitamente fuori scope
di questa versione (vedi `design.md` D3) e non è coperto da nessuno scenario qui.

#### Scenario: creazione di un personaggio con riferimento
- **GIVEN** una foto esistente nel progetto scelta come riferimento
- **WHEN** viene creato un personaggio con quella foto come `reference_photo_id`
- **THEN** il personaggio è persistito con un `id` proprio
- **AND** è associabile a qualunque pannello del progetto tramite `character_ids`

#### Scenario: un pannello referenzia più personaggi
- **GIVEN** due personaggi già creati nel progetto
- **WHEN** un pannello viene associato a entrambi (`character_ids` = array di 2 id)
- **THEN** la lettura del pannello (`get_photo`) espone entrambi gli id associati
- **AND** eliminare un personaggio non associato ad alcun pannello non richiede migrazioni

## Out of Scope (esplicito)

- **Generative Lasso** (redraw di una regione mascherata via AI): non coperto da alcun
  requirement in questa change. Automazione della mascheratura via CDP valutata fragile/
  incerta; richiede uno spike dedicato separato prima di poter scrivere acceptance criteria
  credibili.
- **Share + link/PIN** (condivisione hosted con PIN di accesso): non coperto. Darkroom è
  local-first, senza infrastruttura di hosting condiviso; fuori scope per design, non solo
  per questa change.
- **3D scene blocking / mannequin posabile / rotazione camera**: non coperto in Darkroom per
  scelta esplicita (D1/proposal.md) — questi requirement sono soddisfatti aprendo il file
  esportato nel vero Storyboarder, che li implementa già nativamente.
- **Upload multi-immagine al worker CDP** per applicare visivamente un personaggio pinnato
  durante la generazione: non coperto (vedi design.md D3), richiede uno spike separato su
  `edit_batch.py`/`upload_file` prima di poter scrivere uno scenario verificabile.
