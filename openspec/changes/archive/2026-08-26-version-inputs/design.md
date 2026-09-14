# Design — gli ingressi di una versione diventano righe

## 1. Una tabella sola, non due

La scelta vera è fra:

- **(A)** una tabella `version_inputs` con `kind IN ('source','reference')` e due colonne
  mutuamente esclusive (`photo_id` per le sorgenti, `ref_path` per i riferimenti);
- **(B)** due tabelle, `version_sources(version_id, photo_id, position)` e
  `version_references(version_id, ref_path, position)`, ognuna con la sua chiave esterna
  piena e nessuna colonna che resta NULL.

**Scelta: (A), una tabella sola.** Non perché sia più elegante — (B) è più pulita sul piano
del tipo — ma perché la domanda che si fa davvero al dato è *"cosa è entrato in questa
generazione, e in che ordine"*, ed è una domanda **sola**. Con (B) ogni lettura è una
`UNION ALL` con due `SELECT` che rinominano colonne per farle combaciare, e l'ordine fra
sorgenti e riferimenti — che è l'ordine in cui i file vengono allegati alla richiesta, quindi
un dato che conta — va ricostruito a mano ogni volta. Su `worker-codex-http.ts:198`
l'elenco degli allegati è già `[...sources, ...refs]`: una sequenza unica.

Il prezzo di (A) è una colonna che resta NULL sui riferimenti, e si paga con un `CHECK` che
rende l'esclusione un fatto del DB e non una convenzione. Questa forma è stata **eseguita**
su SQLite, non solo scritta:

```sql
CREATE TABLE IF NOT EXISTS version_inputs (
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('source','reference')),
  -- Il percorso c'è SEMPRE: è ciò che è stato allegato davvero. `photo_id` è
  -- l'identità, quando l'ingresso è una foto del progetto e il nome si risolve.
  path       TEXT    NOT NULL,
  photo_id   TEXT    REFERENCES photos(id) ON DELETE SET NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  origin     TEXT    NOT NULL DEFAULT 'recorded'
                     CHECK (origin IN ('recorded','reconstructed')),
  PRIMARY KEY (version_id, kind, position),
  -- Un riferimento non è una foto del progetto: tenerli sullo stesso campo è
  -- ciò che ha reso il difetto invisibile.
  CHECK (kind = 'source' OR photo_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_version_inputs_photo
  ON version_inputs(photo_id, version_id) WHERE photo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_version_inputs_ref
  ON version_inputs(path) WHERE kind = 'reference';
```

**`path NOT NULL` + `photo_id` separato, invece di due colonne mutuamente esclusive.** La
prima stesura di questo design aveva `photo_id` per le sorgenti e `ref_path` per i
riferimenti, con un `CHECK` che imponeva "sorgente = id **oppure** nome". Eseguita, si è
rotta su un caso che capita davvero: `ON DELETE SET NULL` azzera `photo_id` quando si
cancella una foto, e una riga sorgente che aveva **solo** l'id violava il `CHECK` nel momento
stesso in cui la foto spariva — cioè la cancellazione di una foto falliva con
`CHECK constraint failed`, invece di lasciare l'ingresso orfano come previsto. Con `path`
sempre valorizzato il problema non esiste: azzerare `photo_id` lascia una riga valida che
dice ancora *quale file* è entrato.

Tre dettagli che non sono estetici:

- **`PRIMARY KEY (version_id, kind, position)`** è ciò che rende la migrazione idempotente
  senza una tabella di stato: `INSERT OR IGNORE` rieseguito mille volte scrive le stesse
  righe. È il motivo per cui `position` sta nella chiave e non è una colonna qualsiasi.
- **`photo_id` è nullable anche su `kind='source'`**, con `ON DELETE SET NULL`. Una sorgente
  registrata per nome file che non corrisponde più a nessuna foto del progetto esiste: nel
  lineage di `profilo` i nomi sono `1.PNG`, `56E417C5-….JPG`, `ChatGPT Image Aug 15…png`, e
  la loro risoluzione a id passa da una mappa per basename (`routes/lineage.ts:70`) che può
  fallire. Una sorgente che non si risolve va scritta con `photo_id` NULL e il nome in `path`,
  non buttata: un ingresso mezzo noto resta un ingresso. Su `profilo`, verificato, tutte e 36
  si risolvono; il caso NULL è per gli altri progetti e per il futuro.
- **`origin`**: `recorded` = scritto al momento della generazione; `reconstructed` = dedotto
  dalla migrazione. Serve perché su Japan **2733 versioni su 3007** non hanno un job
  collegato, e la loro unica sorgente è `versions.photo_id`: un'inferenza ragionevole, non un
  fatto registrato. Senza questa colonna la vista non può dire la differenza, e il change
  ricreerebbe in forma relazionale la stessa bugia che sta correggendo.

`ON DELETE CASCADE` su `version_id`: gli ingressi di una versione cancellata non sono dati,
sono rifiuti. `ON DELETE SET NULL` su `photo_id`: cancellare una foto **non** deve cancellare
la prova che ha contribuito a dodici varianti.

## 2. `lineage` resta, e resta storica

**Decisione: `lineage` non si tocca e non si deprecata formalmente. Diventa una colonna
storica, di sola lettura per la migrazione e di sola scrittura additiva per il nuovo codice.**

Tre ragioni misurate, in ordine di peso:

1. **Contiene cose che `version_inputs` non modella e che non vanno perse.** Il lineage di
   `profilo` porta `recipe`, `refset`, `preamble`, `backend`. La ricetta e il preambolo sono
   ciò per cui l'albero raggruppa (`routes/lineage.ts:90`: la chiave di gruppo è
   `refset|recipe|preamble`), e non sono ingressi: sono istruzioni. Svuotare `lineage`
   significherebbe modellare anche quelle in questo change, che è un secondo change.
2. **È la fonte della migrazione.** Cancellarlo dopo aver migrato rende la migrazione non
   ripetibile e irreversibile: se la trasformazione ha un difetto, il dato originale non c'è
   più. Con 36 righe in `profilo` il rischio è piccolo; il principio è che una migrazione che
   distrugge la sorgente non si può verificare due volte.
3. **Il costo di tenerlo è zero.** Nessun `NOT NULL`, nessun indice, nessuna query nuova che
   lo legge dopo la migrazione.

Cosa cambia in concreto: dopo questo change **la verità sugli ingressi è `version_inputs`**.
`lineage` continua a essere scritto (con gli stessi campi di oggi, per non spezzare
`gen_variants.ts`), ma nessuna vista lo interroga più per sapere sorgenti e riferimenti.
Se un giorno diverge, vince la tabella. Questo va scritto nel commento della colonna, perché
un campo che sembra autorevole e non lo è è peggio di un campo assente.

## 3. Migrazione: due fonti, una precedenza, nessuna invenzione

La migrazione gira in `initSchemaOn()` come tutte le altre di questo progetto (stesso
schema di `hasColumn()` + `ALTER`, `server/db.ts:255-444`). Per ogni versione, in ordine:

1. **`lineage.sources` / `lineage.refs`** se presenti → `origin='recorded'`. I nomi si
   risolvono a `photo_id` per basename come fa già la route; quelli che non si risolvono
   diventano righe con `photo_id` NULL e il nome in `ref_path`.
2. **`jobs.ref_paths`** del job con `result_version_id = versions.id`, quando il lineage non
   ha riferimenti → `origin='recorded'` (il job ha allegato quei file davvero).
3. **`versions.photo_id`** come unica sorgente, quando né 1 né 2 dicono niente →
   `origin='reconstructed'`, `position=0`.

Il passo 3 non è un ripiego: è il caso **maggioritario**. Su Japan `lineage` è NULL su
**tutte** le 3007 versioni, quindi tutte e 3007 le righe `source` nascono da `photo_id` e
sono `reconstructed`. Solo 274 versioni hanno un job collegato (254 delle quali con un
riferimento allegato, che diventa una riga `recorded`); le altre **2733** non hanno nemmeno
quello. Marcarle `reconstructed` è ciò che permette alla vista di non spacciarle per
registrate.

Volumi e tempi **eseguiti** su copie dei DB reali (26/08/2026, mai sull'originale):

| DB | righe `source` | righe `reference` | `reconstructed` | durata |
|---|---|---|---|---|
| `profilo` (3 foto, 12 versioni, 29 job) | **36** (tutte `recorded`, tutte risolte a un id foto) | **0** | 0 | < 0,1 s |
| `photos.db` del repo (190 foto, 3007 versioni, 685 job) | **3007** | **254** | **3007** | **0,06 s** |

Le 0 righe `reference` di `profilo` non sono un difetto della migrazione: sono il difetto che
il change corregge, scritto senza abbellirlo. Il lineage dice `refs: []` dodici volte su
dodici, e l'unico job con un file allegato (id 164) è fallito su 429 senza produrre versione.

**Idempotenza.** `INSERT OR IGNORE` sulla PK composta. Rieseguire la migrazione su un DB già
migrato scrive zero righe e non solleva errori. Non serve una tabella `schema_migrations`:
questo progetto non ne ha una, e introdurla qui sarebbe un secondo change travestito.

**Cosa NON fa la migrazione**: non inventa reference per le 12 varianti di `profilo`, non
prova a dedurre dal filesystem quali file *sarebbero potuti* essere allegati, non riscrive
`versions.photo_id`.

## 4. Il vincolo che chiude il buco

Oggi la catena di silenzi è questa, in tre punti di codice:

| Dove | Cosa fa | Effetto |
|---|---|---|
| `gen_variants.ts:189` | passa `JSON.stringify(refs)` a `enqueueJob` | se `refs` è `[]`, il refset dice comunque "+ stile" |
| `jobs.ts:66` | `parseRefPaths` filtra con `existsSync` | un file sparito diventa "nessun file", senza dirlo |
| `worker-codex-http.ts:93` | `if (existsSync(r))` prima di allegare | idem, un secondo giro dopo |

Ognuno dei tre è ragionevole da solo. Insieme producono una generazione che gira, riesce, e
non è quella che si era chiesta.

**Il vincolo: un job che DICHIARA dei riferimenti deve averli allegati, o fallisce prima di
partire.** In concreto, `jobs.declared_refs` (JSON array di nomi, scritto da chi accoda) e un
controllo all'ingresso del worker: se `declared_refs` non è vuoto e i file corrispondenti non
esistono tutti, il job va in `failed` con scritto **quale** manca, e nessuna immagine viene
prodotta.

Perché una colonna nuova e non un controllo su `config.refset`: `refset` è una **stringa
descrittiva** costruita a runtime (`gen_variants.ts:180`, roba come
`"3 sorgenti insieme + stile"`), leggibile da un umano e non parsabile senza indovinare.
Fondare un vincolo su una stringa da mostrare è come fondare la logica sul testo di un
bottone. `declared_refs` è la stessa informazione in forma verificabile.

**Perché fallire e non degradare.** Un job che parte senza gli allegati promessi produce
un'immagine plausibile e sbagliata, che costa quota, tempo e — misurato — dodici giudizi
umani su varianti che non avevano nessuna possibilità di centrare il bersaglio. Un job che
fallisce costa un messaggio di errore. La coda ha già la nozione di fallimento non
ritentabile (`photos.skipped`, `skip_reason`), quindi non serve niente di nuovo per gestirlo.

**Dove NON deve mordere.** Un job senza `declared_refs` (cioè tutto lo storico e tutti i job
dell'interfaccia normale) si comporta esattamente come oggi: `NULL` significa "non ho
dichiarato niente", non "ho dichiarato zero riferimenti". Dei 685 job di Japan, **658** hanno
`ref_paths` valorizzato e nessuno ha `declared_refs`: devono restare intatti.

## 5. Vista albero: la radice non è più la prima sorgente

Oggi `/api/lineage` fa `SELECT … FROM versions WHERE photo_id = ?` per ogni foto. Con la
tabella diventa una `JOIN` su `version_inputs`, e cambiano due cose visibili:

- **Il conteggio.** Una foto conta le varianti a cui ha **contribuito**, non quelle appese al
  suo `photo_id`. Su `profilo` le due foto che oggi leggono `variants=0` passano a `12` —
  numero verificato: tutte e 12 le versioni hanno le tre sorgenti nel lineage.
- **La radice.** Un gruppo con più sorgenti non ha una radice sola. La striscia "DA 3 SCATTI"
  (`Albero.tsx:132-150`) smette di essere un cerotto sul JSON e diventa la resa naturale
  della relazione: le sorgenti del gruppo, tutte, senza che una sia promossa a titolo della
  colonna.

L'etichetta `SORGENTE 01` (`Albero.tsx:91-93`, `String(i + 1)`) è l'indice di posizione nella
lista, che con una foto che appare in gruppi altrui non vuole più dire niente. Va sostituita
dall'identità della foto.

**Il rischio che questo introduce, e come si paga.** Con il conteggio per contributo, una
variante nata da tre sorgenti compare **tre volte** nell'albero, una per radice. Su `profilo`
significa 36 tessere dove oggi ce ne sono 12. È corretto (quella variante *è* nata anche da
quella foto) ma va detto in pagina, altrimenti sembra che le generazioni siano triplicate. La
resa scelta: la tessera duplicata mostra che è condivisa e con chi, e il contatore in fondo
alla pagina continua a contare **varianti distinte** (12), non tessere (36).

Alternativa scartata: una sezione "generazioni multi-sorgente" separata dalle radici
per-foto. Rimette in piedi la stessa separazione fra "il caso normale" e "il caso strano" che
è la causa di questo change.

## 6. Cosa NON cambia

- Il motore di generazione, la coda, il locking, `runnerLock`.
- `versions.photo_id` e `UNIQUE(photo_id, version_number)`: la convenzione `v<NN>.png` da cui
  la UI ricostruisce gli URL resta intatta (3007 anteprime su Japan dipendono da lei).
- La griglia, la vista dettaglio, il video editor.
- `versions.lineage`: continua a essere scritto com'è oggi.

## 7. Rischi

| Rischio | Come si paga |
|---|---|
| La migrazione sbaglia a risolvere i nomi in `photo_id` | La riga si scrive comunque, con `photo_id` NULL e il nome grezzo: nessun ingresso sparisce in silenzio |
| L'albero con tessere duplicate confonde | Tessera marcata come condivisa + contatore su varianti distinte |
| `declared_refs` blocca job legittimi | Morde **solo** quando è valorizzato; NULL = comportamento di oggi, verificato su 658 job storici |
| `version_inputs` e `lineage` divergono | La tabella è autorevole, dichiarato nel commento della colonna e in `LIN-04` |
| 3007+254 righe su Japan rallentano le query | Due indici parziali; il volume è un ordine di grandezza sotto `versions`, già indicizzata |
