## ADDED Requirements

### Requirement: VIN-01 — Gli ingressi di una versione sono righe, non JSON

Il sistema SHALL registrare gli ingressi di ogni versione generata come righe di una tabella
`version_inputs`, una riga per ingresso, con: la versione, il ruolo (`source` o `reference`),
il percorso del file, l'id della foto quando l'ingresso è una foto del progetto, la posizione
nell'ordine di allegamento, e se l'ingresso è stato **registrato** alla generazione o
**ricostruito** da un dato preesistente.

Un ingresso `reference` SHALL avere `photo_id` NULL: un riferimento è un file, non una foto
del progetto, e tenerli sullo stesso campo è ciò che ha reso il difetto invisibile. Il
percorso SHALL essere sempre presente, anche quando la foto non si risolve: un ingresso
mezzo noto resta un ingresso, e buttarlo riprodurrebbe la perdita che il change corregge.

Motivazione misurata sul progetto `profilo` il 26/08/2026: le 12 versioni generate dichiarano
tutte tre sorgenti nel campo `versions.lineage`, per un totale di **36 ingressi sorgente**,
e **zero** di questi è una relazione che il database possa interrogare o vincolare. Lo schema
dice `versions.photo_id NOT NULL` con chiave esterna verso `photos`, cioè "una versione
appartiene a una foto": una frase che il lavoro reale smentisce 12 volte su 12.

#### Scenario: variante nata da tre sorgenti e un riferimento
- **GIVEN** una generazione con tre foto sorgente e un file di riferimento di stile
- **WHEN** la generazione riesce e la versione viene scritta
- **THEN** `version_inputs` contiene quattro righe per quella versione
- **AND** tre hanno `kind='source'` con `position` 0, 1, 2 nell'ordine di allegamento
- **AND** una ha `kind='reference'`, `photo_id` NULL e il percorso del file di stile
- **AND** tutte hanno origine `recorded`

#### Scenario: sorgente che non corrisponde a nessuna foto del progetto
- **GIVEN** una versione il cui ingresso cita un file non più presente fra le foto
- **WHEN** l'ingresso viene registrato
- **THEN** la riga esiste con `photo_id` NULL e il percorso conservato
- **AND** la vista la mostra come ingresso non risolto, non la nasconde

#### Scenario: cancellare una foto non cancella la prova che ha contribuito
- **GIVEN** una foto che è sorgente di dodici varianti
- **WHEN** la foto viene rimossa dal progetto
- **THEN** le righe `version_inputs` restano, con `photo_id` azzerato e il percorso intatto
- **AND** le dodici varianti restano leggibili con i loro ingressi

#### Scenario: cancellare una versione porta via i suoi ingressi
- **GIVEN** una versione con quattro righe di ingresso
- **WHEN** la versione viene cancellata
- **THEN** le quattro righe spariscono con lei

### Requirement: VIN-02 — La migrazione legge lo storico e non lo perde

Il sistema SHALL popolare `version_inputs` a partire dai dati già presenti, all'apertura del
database, senza intervento manuale e senza cancellare la fonte. Le fonti SHALL essere
consultate in quest'ordine, per versione:

1. `versions.lineage` (campi `sources` e `refs`) quando presente → origine `recorded`;
2. `jobs.ref_paths` del job che ha prodotto la versione, per i riferimenti che il lineage non
   dichiara → origine `recorded`;
3. `versions.photo_id` come unica sorgente, quando né 1 né 2 dicono niente → origine
   `reconstructed`.

La migrazione SHALL essere idempotente: rieseguirla su un database già migrato SHALL
scrivere zero righe e non SHALL sollevare errori.

Il sistema NON SHALL dedurre riferimenti che nessuna fonte dichiara. Sulle 12 varianti di
`profilo` il lineage riporta `refs: []` dodici volte su dodici: la migrazione produce zero
righe `reference`, e questo è il difetto scritto senza abbellirlo, non un dato da inventare.

Volumi verificati eseguendo la trasformazione su copie dei database reali (26/08/2026):

| Database | righe `source` | righe `reference` | di cui `reconstructed` | durata |
|---|---|---|---|---|
| `profilo` (3 foto, 12 versioni, 29 job) | 36 | 0 | 0 | < 0,1 s |
| `photos.db` del repo (190 foto, 3007 versioni, 685 job) | 3007 | 254 | 3007 | 0,06 s |

Su Japan `lineage` è NULL su tutte le versioni, quindi ogni riga `source` nasce dal passo 3
ed è ricostruita; le 254 righe `reference` vengono dal passo 2 e sono registrate.

#### Scenario: versione con lineage completo
- **GIVEN** una versione il cui `lineage` elenca tre sorgenti
- **WHEN** la migrazione gira
- **THEN** nascono tre righe `source` con origine `recorded`
- **AND** le tre sorgenti sono risolte all'id della foto corrispondente quando il nome
  combacia con una foto del progetto

#### Scenario: versione senza lineage ma con un job collegato
- **GIVEN** una versione prodotta da un job che aveva un file di riferimento allegato
- **AND** `versions.lineage` è NULL
- **WHEN** la migrazione gira
- **THEN** nasce una riga `reference` con quel percorso e origine `recorded`
- **AND** nasce una riga `source` da `photo_id` con origine `reconstructed`

#### Scenario: versione storica senza lineage e senza job
- **GIVEN** una delle 2733 versioni del progetto Japan senza job collegato né lineage
- **WHEN** la migrazione gira
- **THEN** nasce una sola riga `source` da `photo_id`, con origine `reconstructed`
- **AND** la vista la dichiara ricostruita, non registrata

#### Scenario: la migrazione si rifà senza raddoppiare
- **GIVEN** un database già migrato con 3261 righe di ingresso
- **WHEN** il database viene riaperto e la migrazione rigira
- **THEN** le righe restano 3261
- **AND** nessun errore viene sollevato

### Requirement: VIN-03 — `lineage` resta come colonna storica, la tabella è autorevole

Il sistema SHALL conservare `versions.lineage` e SHALL continuare a scriverlo con i campi di
oggi (`recipe`, `refset`, `preamble`, `sources`, `refs`, `backend`), perché contiene
informazioni che `version_inputs` non modella: la ricetta e il preambolo sono **istruzioni**,
non ingressi, e sono la chiave con cui l'albero raggruppa le varianti.

Dopo questo change, la fonte autorevole su sorgenti e riferimenti SHALL essere
`version_inputs`. Nessuna vista SHALL leggere `lineage.sources` o `lineage.refs` per
rispondere alla domanda "da cosa è nata questa variante". Quando i due divergono, vince la
tabella.

Motivazione: cancellare `lineage` dopo la migrazione renderebbe la migrazione non ripetibile
e non verificabile, perché distruggerebbe la sua sorgente. Il costo di tenerlo è zero:
nessun `NOT NULL`, nessun indice, nessuna query nuova.

#### Scenario: la ricetta continua a raggruppare
- **GIVEN** dodici varianti prodotte da cinque ricette diverse
- **WHEN** si apre la vista ad albero
- **THEN** i gruppi restano cinque, uno per ricetta, come oggi
- **AND** la ricetta viene letta da `lineage`, non da `version_inputs`

#### Scenario: divergenza fra tabella e lineage
- **GIVEN** una versione con due sorgenti in `version_inputs` e tre in `lineage.sources`
- **WHEN** la vista chiede da cosa è nata
- **THEN** risponde con le due della tabella
