## ADDED Requirements

> LIN-04 e LIN-05 **restringono** LIN-02 del change `2026-08-25-scelta-e-reference`, che
> definisce la vista ad albero ma lascia implicito che ogni foto sia radice delle proprie
> varianti. Non lo sostituiscono: LIN-02 resta valido su tutto il resto (raggruppamento per
> configurazione, voto `tieni|forse|scarta`, note, esportazione). Qui si fissa **da dove**
> la vista prende le radici e gli ingressi.

### Requirement: LIN-04 — La radice dell'albero è la foto che ha contribuito, non la prima sorgente

Il sistema SHALL costruire la vista ad albero a partire da `version_inputs`, non da
`versions.photo_id`. Ogni foto SHALL comparire come radice delle varianti a cui ha
**contribuito** come sorgente, indipendentemente dalla posizione che occupava nell'ordine di
allegamento.

Il conteggio delle varianti di una radice SHALL essere il numero di versioni distinte a cui
quella foto ha contribuito. Una foto che ha contribuito senza essere la prima sorgente NON
SHALL comparire con zero varianti.

Difetto misurato il 26/08/2026 chiamando `GET /api/lineage` sul Darkroom vivo, progetto
`profilo`:

```
1                                     | variants=12 | gruppi=5
56E417C5-821D-4DC9-B5DD-D76E0F305BB6  | variants=0  | gruppi=0
ChatGPT Image Aug 15, 2026, 11_25_32  | variants=0  | gruppi=0
```

**2 foto su 3** leggono "0 varianti" pur avendo contribuito a tutte e dodici: il lineage di
ognuna delle 12 versioni le elenca entrambe fra le sorgenti. La causa è
`routes/lineage.ts:76`, che seleziona `WHERE photo_id = ?`, e `photo_id` è per costruzione
la **prima** foto dell'insieme (`scripts/gen_variants.ts:150`). Eseguendo la migrazione su
una copia del database, la stessa domanda risponde `12 | 12 | 12`.

Conseguenza sulla resa: una variante nata da tre sorgenti compare sotto tre radici. Su
`profilo` significa 36 tessere dove oggi ce ne sono 12. È corretto — quella variante *è* nata
anche da quella foto — ma SHALL essere dichiarato in pagina, e il contatore complessivo SHALL
contare **varianti distinte**, non tessere.

#### Scenario: foto che contribuisce senza essere la prima sorgente
- **GIVEN** dodici varianti nate dalle stesse tre foto insieme
- **WHEN** si apre la vista ad albero
- **THEN** ognuna delle tre foto compare come radice con dodici varianti
- **AND** nessuna delle tre legge "0 varianti"

#### Scenario: il contatore non triplica
- **GIVEN** dodici varianti condivise da tre radici, cioè 36 tessere in pagina
- **WHEN** si legge il contatore complessivo in fondo alla vista
- **THEN** dice dodici, non trentasei

#### Scenario: variante condivisa dichiarata come tale
- **GIVEN** una tessera che compare sotto tre radici diverse
- **WHEN** viene mostrata sotto una di esse
- **THEN** dichiara di essere condivisa e con quali altre foto
- **AND** giudicarla sotto una radice la aggiorna sotto tutte

#### Scenario: foto a sorgente singola
- **GIVEN** una foto le cui varianti sono nate solo da lei
- **WHEN** si apre la vista ad albero
- **THEN** compare come unica radice delle sue varianti, come oggi

### Requirement: LIN-05 — La striscia delle sorgenti smette di essere un cerotto sul JSON

Il sistema SHALL mostrare gli ingressi di un gruppo di varianti leggendoli da
`version_inputs`, e SHALL mostrare anche i **riferimenti**, non solo le sorgenti. La vista
SHALL distinguere un ingresso registrato alla generazione da uno ricostruito dalla
migrazione, e SHALL dichiarare quando un gruppo non ha riferimenti.

Oggi `client/src/pages/Albero.tsx:132-150` ricostruisce a mano dal JSON la relazione che il
database non modella, con un commento che lo ammette ("*una variante nata da piu' scatti ha
comunque un photo_id solo*"), e i riferimenti non compaiono affatto nel modello dati della
vista: `Group` ha `sources` e non ha `refs`. La striscia "DA 3 SCATTI" appare solo se
`sources.length > 1`, cioè il caso multi-sorgente è trattato come eccezione da segnalare
invece che come forma normale del dato.

L'etichetta `SORGENTE 01` (`Albero.tsx:91-93`) è l'indice di posizione nella lista delle
foto: con una foto che compare come radice di varianti condivise non vuole più dire niente,
e SHALL essere sostituita dall'identità della foto.

#### Scenario: gruppo con riferimenti allegati
- **GIVEN** un gruppo di varianti nate con un riferimento di stile
- **WHEN** viene mostrato nell'albero
- **THEN** il riferimento compare fra gli ingressi del gruppo, distinto dalle sorgenti
- **AND** è visibile come miniatura, non solo come nome

#### Scenario: gruppo senza riferimenti
- **GIVEN** uno dei cinque gruppi di `profilo`, nati tutti con `refs: []`
- **WHEN** viene mostrato nell'albero
- **THEN** dichiara di non avere riferimenti allegati
- **AND** non lascia credere che il refset dichiarato corrisponda a file allegati

#### Scenario: ingresso ricostruito
- **GIVEN** una delle 3007 versioni di Japan, la cui sorgente è stata ricostruita da `photo_id`
- **WHEN** viene mostrata nell'albero
- **THEN** l'ingresso è marcato come ricostruito
- **AND** non viene presentato come registrato alla generazione

#### Scenario: una sorgente sola resta leggibile
- **GIVEN** un gruppo con una sola foto sorgente e nessun riferimento
- **WHEN** viene mostrato
- **THEN** la vista non aggiunge una striscia di ingressi ridondante rispetto alla radice
