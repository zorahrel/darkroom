## ADDED Requirements

> LIN-04 e LIN-05 **restringono** LIN-02 del change `2026-08-25-scelta-e-reference`, che
> definisce la vista ad albero ma lascia implicito che ogni foto sia radice delle proprie
> varianti. Non lo sostituiscono: LIN-02 resta valido su tutto il resto (raggruppamento per
> configurazione, voto `tieni|forse|scarta`, note, esportazione). Qui si fissa **da dove**
> la vista prende le radici e gli ingressi.

### Requirement: LIN-04 — La radice dell'albero è l'insieme di ingresso

Il sistema SHALL costruire la vista ad albero raggruppando le varianti per
**insieme di sorgenti**, non per singola foto. L'identità di un insieme SHALL
essere data dai suoi `photo_id` ordinati, così che l'ordine di allegamento non
produca radici diverse per lo stesso insieme.

Una variante NON SHALL comparire sotto più di una radice. Una foto sola SHALL
essere trattata come l'insieme di cardinalità 1, senza casi speciali.

Due regole sbagliate, e perché. Raggruppare per `versions.photo_id` (il
comportamento fino al 26/08) metteva tutte le varianti sotto la **prima**
sorgente: su `profilo`, 12 varianti sotto una foto e `0 varianti` sulle altre
due, che avevano contribuito a tutte e dodici. La correzione apparente — una
radice per ogni foto che ha contribuito — è peggiore: darebbe **3 radici con le
stesse 12 varianti**, cioè 36 apparizioni per 12 generazioni reali, e il
conteggio smetterebbe di dire quante ne esistono.

Misurato il 26/08/2026: `profilo` ha **un solo** insieme distinto (le 3 foto
insieme) condiviso da tutte le 12 versioni → **1 radice**. Japan ha **189**
insiemi, tutti di cardinalità 1, per 3007 versioni → 189 radici, ognuna contata
una volta, esattamente come prima del change.

I nomi di sorgente che non si risolvono a una foto nota SHALL restare
nell'identità dell'insieme invece di essere scartati: scartarli farebbe
collassare in una sola radice due insiemi diversi.

#### Scenario: dodici varianti da tre scatti
- **GIVEN** 12 versioni che dichiarano le stesse 3 foto sorgente
- **WHEN** si apre la vista ad albero
- **THEN** compare **una** radice che mostra tutte e tre le miniature
- **AND** riporta 12 varianti, ognuna elencata una volta sola
- **AND** nessuna delle tre foto compare separatamente con "0 varianti"

#### Scenario: progetto a sorgente singola
- **GIVEN** un progetto in cui ogni versione nasce da una sola foto
- **WHEN** si apre la vista ad albero
- **THEN** il numero di radici e di varianti è identico a prima del change
- **AND** la radice mostra una miniatura sola, senza etichette sull'insieme

#### Scenario: insiemi che si sovrappongono
- **GIVEN** varianti nate da `{A,B}` e altre da `{A,B,C}`
- **WHEN** si apre la vista ad albero
- **THEN** sono **due radici distinte**, non una gerarchia
- **AND** nessuna variante compare in entrambe

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
