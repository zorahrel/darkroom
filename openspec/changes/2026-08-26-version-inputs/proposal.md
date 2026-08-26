## Why

Lo schema dice una cosa che il lavoro vero smentisce da due giorni. `versions.photo_id` è
`TEXT NOT NULL` con una chiave esterna verso `photos(id)`: **una versione appartiene a una
foto**. Ma una variante di `Profilo` nasce da **tre scatti insieme più una reference di
stile**, e tutto ciò che eccede quella singola foto vive in `versions.lineage` — una colonna
TEXT con dentro del JSON. Nessun vincolo, non interrogabile, e nessuno si accorge se resta
vuota.

Il costo è misurato sul progetto `profilo`
(`$HOME/Darkroom/projects/profilo/photos.db`, letto in sola lettura su copia):

| Cosa | Misura |
|---|---|
| Job totali | **29** (12 `done`, 17 `failed`) |
| Job con `ref_paths` valorizzato | **1 su 29** — ed è l'unico `failed` per quota (HTTP 429) |
| Versioni generate | **12** |
| Versioni con `refs` non vuoto nel lineage | **0 su 12** |
| Versioni il cui lineage dichiara più di una sorgente | **12 su 12** |
| Righe `lineage.sources` in totale | **36** (tre per versione), zero delle quali è una relazione nel DB |

Il buco si legge in una riga sola. I 28 job senza reference dichiarano
`config.refset = "3 sorgenti insieme"` e `config.refs = []`; l'unico job che dichiarava
`"3 sorgenti insieme + stile"` con `refs = ["style-bw-wet-hair-hardlight.png"]` è morto sul
429 alle 16:49 del 25/08. Le 12 generazioni riuscite sono arrivate **dopo**, dalle 19:30 in
poi, tutte senza il file di stile. Nessuno si è accorto di niente, perché **niente obbliga il
refset dichiarato a corrispondere a file davvero allegati**: `parseRefPaths()` scarta in
silenzio i percorsi inesistenti (`server/jobs.ts:66`) e `worker-codex-http.ts:93` fa lo stesso
con `if (existsSync(r))`. Un allegato che sparisce non è un errore: è una generazione muta e
diversa.

La differenza non è teorica. Con la reference allegata i capelli escono bagnati come nel
target; senza, asciutti. Dodici generazioni sono uscite lontane dal bersaglio, e il DB non
aveva un solo campo capace di dirlo.

**Il secondo effetto è sulla vista albero.** `client/src/pages/Albero.tsx` ha un cerotto: la
striscia "DA 3 SCATTI" (righe 132-150) ricostruisce a mano dal JSON una relazione che il DB
non modella, e la radice mostra "SORGENTE 01" perché `/api/lineage` raggruppa per `photo_id`,
cioè per la **prima** sorgente. Misurato adesso sul Darkroom vivo (`GET /api/lineage` su
`profilo`):

```
1                                     | variants=12 | gruppi=5
56E417C5-821D-4DC9-B5DD-D76E0F305BB6  | variants=0  | gruppi=0
ChatGPT Image Aug 15, 2026, 11_25_32  | variants=0  | gruppi=0
```

**2 foto su 3** compaiono con "0 varianti" pur avendo contribuito a tutte e dodici. Non è un
difetto di resa: è lo schema che risponde correttamente a una domanda sbagliata.

## What Changes

Una capability nuova, `version-inputs`, che sposta la relazione dal JSON al DB.

| # | Cosa | Perché adesso |
|---|---|---|
| 1 | Tabella `version_inputs(version_id, kind, photo_id, ref_path, position)`, `kind IN ('source','reference')` | Una riga per ingresso: la relazione diventa interrogabile e vincolata |
| 2 | Migrazione idempotente da `lineage` JSON, con `jobs.ref_paths` come seconda fonte | 36 righe sorgente e i reference dei job recuperabili senza perdere lo storico |
| 3 | `jobs.declared_refs`: un job che dichiara un refset **fallisce** se i file non ci sono | Chiude il buco che ha prodotto 12 generazioni sbagliate in silenzio |
| 4 | `/api/lineage` e vista albero ricostruite sulla tabella | Le 2 foto a "0 varianti" tornano a mostrare le 12 a cui hanno contribuito |

`lineage` **resta**, come colonna storica di sola lettura e in sola scrittura additiva.
L'argomentazione sta in `design.md`.

## Impact

- **Schema**: una tabella nuova (`version_inputs`) più due indici; una colonna nuova su
  `jobs` (`declared_refs`). Nessun `DROP`, nessuna colonna rimossa, nessun `NOT NULL`
  aggiunto a dati esistenti.
- **Migrazione**: gira dentro `initSchemaOn()` come tutte le altre, idempotente per
  costruzione (`INSERT OR IGNORE` su chiave primaria composta). Volumi **eseguiti** su copie
  dei DB reali, mai sugli originali:
  - `profilo`: **36** righe `source` (tutte risolte a un id foto), **0** righe `reference` —
    il lineage le ha vuote, ed è esattamente il difetto che il change corregge, non un dato
    da inventare;
  - `photos.db` del repo (Japan, 190 foto): `lineage` è NULL su **tutte** le 3007 versioni,
    quindi nascono **3007** righe `source` da `photo_id`, tutte marcate come ricostruite,
    più **254** righe `reference` dai job collegati. Solo **274** versioni su 3007 hanno un
    job che le confermi: le altre **2733** restano con la sola sorgente dedotta, dichiarata
    come ricostruita e non come registrata. Durata misurata: **0,06 s**.
- **API**: `/api/lineage` cambia forma (aggiunge `refs` sui gruppi e conta le varianti per
  contributo, non per `photo_id`). Non ha altri consumatori oltre a `Albero.tsx`
  (verificato: unica occorrenza in `client/src/`).
- **Progetti esistenti**: continuano a funzionare senza toccare un file. Una versione senza
  ingressi ricostruibili resta visibile e dichiarata come tale.

## Non-goals

- **Nessuna rigenerazione** delle 12 varianti sbagliate di `profilo`: questo change rende
  impossibile ripetere l'errore, non ripara il lavoro già fatto.
- **Nessuna deduplicazione** delle reference in una tabella `references` con id propri: i
  percorsi restano percorsi. Una tabella di entità reference è un change suo, e oggi
  `profilo` ha **un solo file** in `data/refs/`.
- **Nessun cambio al motore** di generazione (`codex-http`, `cdp`, `openai` restano com'è).
- **Nessuna riscrittura di `versions.photo_id`**: resta la foto di appartenenza, con il suo
  `UNIQUE(photo_id, version_number)` e la convenzione `v<NN>.png` da cui la UI ricostruisce
  gli URL. Toccarlo romperebbe le anteprime di 3007 versioni per un guadagno che
  `version_inputs` dà già.
