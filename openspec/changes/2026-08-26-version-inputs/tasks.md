# Tasks — gli ingressi di una versione diventano righe

Convenzione: `[ ]` da fare, `[x]` fatto+verificato.

**Stato: in attesa di approvazione di Attilio. Nessun codice prima dell'approvazione.**

## BARRA (si scrive ora, si esegue sempre uguale)

Comandi, misure e artefatti. Ciò che è verde resta verde.

**Cancelli generali**
- `bunx tsc --noEmit` esce zero
- `bun test` esce zero e i test restano **387** o più (misurato oggi, prima di toccare
  niente: `387 tests, 385 pass, 2 skip, 0 fail` in 20 file — i 2 skip sono `openaiE2E`,
  che vuole una chiave)
- Nessun test esistente rimosso o disattivato per far passare il change

**Cancelli di questo change**
- Migrazione su copia di `profilo` → esattamente **36 righe** `kind='source'`, tutte
  `origin='recorded'`, tutte con `photo_id` risolto; **0 righe** `reference`
- Migrazione su copia di `photos.db` del repo → **3007 righe** `source` (tutte
  `reconstructed`) + **254 righe** `reference`, in **meno di 1 secondo** (misurato: 0,06 s)
- La stessa migrazione rieseguita **tre volte** lascia il conteggio invariato
- `PRAGMA foreign_key_check` vuoto su entrambe le copie dopo la migrazione
- Cancellare una foto che è sorgente di N varianti **riesce** e lascia le righe con
  `photo_id` NULL e `path` intatto (il `CHECK` non deve mordere qui: è il caso su cui la
  prima stesura dello schema si è rotta, vedi `design.md` §1)
- Cancellare una versione porta via le sue righe di ingresso
- `GET /api/lineage` su `profilo` risponde **12 | 12 | 12** dove oggi risponde
  **12 | 0 | 0** (l'artefatto di riferimento è l'output di oggi, in `proposal.md`)
- Un job che dichiara un riferimento assente va in `failed` **senza** produrre un file e
  **senza** consumare quota, con il nome del file nell'errore
- Un job senza dichiarazione si comporta come oggi (verificato su un caso costruito come i
  658 job storici di Japan: `ref_paths` valorizzato, nessuna dichiarazione)
- Albero aperto in pagina su `profilo`: 3 radici, ognuna con 12 varianti, contatore in fondo
  che dice **12** e non 36. Prova: **video** `.webm`, non uno screenshot: il comportamento da
  dimostrare è che giudicare una tessera condivisa la aggiorna sotto tutte e tre le radici.

**Fuori dalla barra** (dichiarato per non allargarsi in corsa)
- Rigenerare le 12 varianti sbagliate di `profilo`
- Toccare `client/src/pages/Video.tsx` o `server/video.ts` (altra sessione al lavoro)
- Riavviare il Darkroom vivo su :3737

## 1. Schema
- [ ] 1.1 `version_inputs` in `SCHEMA_STATEMENTS` (`server/db.ts`), nella forma provata in
      `design.md` §1: `path NOT NULL`, `photo_id` nullable, `CHECK (kind='source' OR photo_id IS NULL)`
- [ ] 1.2 I due indici parziali (`photo_id` per le radici, `path` per i riferimenti)
- [ ] 1.3 `VersionInputRow` esportato accanto agli altri tipi di `db.ts`
- [ ] 1.4 Commento su `versions.lineage`: colonna storica, la tabella è autorevole (VIN-03)

## 2. Migrazione
- [ ] 2.1 Migrazione in `initSchemaOn()`, nell'ordine di `design.md` §3: lineage → job → `photo_id`
- [ ] 2.2 Risoluzione dei nomi a `photo_id` per basename; ciò che non si risolve resta riga
      con `photo_id` NULL, mai scartato
- [ ] 2.3 `INSERT OR IGNORE` sulla PK composta: nessuna tabella di stato delle migrazioni
- [ ] 2.4 Test su handle usa-e-getta con schema v0, come fa già `tests/db.test.ts`
- [ ] 2.5 Test di idempotenza: tre giri, conteggio invariato
- [ ] 2.6 Test dei tre casi di origine: `recorded` da lineage, `recorded` da job,
      `reconstructed` da `photo_id`

## 3. Scrittura al momento della generazione
- [ ] 3.1 Le righe di ingresso si scrivono dove si scrive la versione, nella stessa
      transazione: una versione senza ingressi non deve poter esistere
- [ ] 3.2 `scripts/gen_variants.ts` scrive gli ingressi oltre al lineage (che resta)
- [ ] 3.3 Il worker scrive gli ingressi per i job normali dell'interfaccia
- [ ] 3.4 `position` = ordine reale di allegamento, quello di `[...sources, ...refs]`

## 4. Il vincolo (REF-10)
- [ ] 4.1 `jobs.declared_refs` (JSON array), NULL sullo storico
- [ ] 4.2 Controllo all'ingresso del worker: file dichiarati tutti presenti, o `failed`
      con il nome di quello che manca
- [ ] 4.3 `enqueueJob` accetta la dichiarazione; `gen_variants.ts` la valorizza con i
      reference che il refset promette
- [ ] 4.4 Segnalazione della contraddizione fra `config.refset` che promette e dichiarazione
      vuota
- [ ] 4.5 Test: dichiarato+assente → fallisce prima di generare; dichiarato+presente →
      allegato; due dichiarati e uno assente → nomina solo quello; nessuna dichiarazione →
      comportamento di oggi

## 5. Vista albero
- [ ] 5.1 `/api/lineage` legge `version_inputs`: radici per contributo, non per `photo_id`
- [ ] 5.2 I gruppi espongono anche i **riferimenti**, oggi assenti dal tipo `Group`
- [ ] 5.3 `Albero.tsx`: la striscia degli ingressi smette di essere condizionata a
      `sources.length > 1`; sorgenti e riferimenti distinti
- [ ] 5.4 `SORGENTE 01` sostituita dall'identità della foto
- [ ] 5.5 Tessera condivisa dichiarata come tale; il giudizio si propaga a tutte le radici
- [ ] 5.6 Ingressi `reconstructed` marcati, non spacciati per registrati
- [ ] 5.7 Contatore in fondo su varianti distinte

## 6. Verifica finale
- [ ] 6.1 I due cancelli generali della barra
- [ ] 6.2 Migrazione su copia di `profilo` e su copia di `photos.db`: conteggi, idempotenza,
      `foreign_key_check`, durata
- [ ] 6.3 `GET /api/lineage` su `profilo`: 12 | 12 | 12
- [ ] 6.4 Video `.webm` dell'albero: tre radici, tessera condivisa giudicata una volta e
      aggiornata sotto tutte e tre, contatore a 12
- [ ] 6.5 Japan aperto in griglia: 190 foto, nessuna anteprima rotta (la convenzione
      `v<NN>.png` non è stata toccata, ma è la cosa che si rompe in silenzio)
