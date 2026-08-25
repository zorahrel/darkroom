## ADDED Requirements

### Requirement: LIN-01 — Ogni variante registra da cosa è nata

Il sistema SHALL salvare su ogni versione generata un record `lineage` contenente: le foto
sorgente usate, i file di riferimento allegati, la chiave della ricetta, e l'identificativo
del preambolo applicato. Il record SHALL essere scritto al momento della generazione, non
ricostruito dopo.

Motivazione misurata: due passate con gli stessi tre riferimenti ma preamboli diversi hanno
prodotto risultati diversi ed erano indistinguibili in griglia; una di quelle due diceva al
modello di ignorare l'aspetto delle reference, e l'errore è emerso solo dall'occhio umano.

#### Scenario: variante nata da tre sorgenti e un riferimento
- **GIVEN** un job con tre foto sorgente e un file di riferimento
- **WHEN** la generazione riesce
- **THEN** la versione riporta i tre id sorgente, il nome del file di riferimento, la ricetta
  e l'id del preambolo
- **AND** la vista ad albero la mostra collegata a tutte e tre le sorgenti

#### Scenario: storico senza lineage
- **GIVEN** una versione generata prima di questo change
- **WHEN** viene aperta nella vista ad albero
- **THEN** compare sotto "origine non registrata"
- **AND** non viene nascosta, né le viene attribuita un'origine ipotetica

### Requirement: LIN-02 — Una vista ad albero orientata alla scelta

Il sistema SHALL offrire una vista, distinta dalla griglia, che mostra ogni foto sorgente
come radice e le sue varianti come rami, con la configurazione leggibile accanto a ciascun
ramo. La vista SHALL permettere di assegnare a ogni variante uno stato fra
`tieni | forse | scarta` e una nota di testo, e di eleggere una variante come preferita.

La griglia resta com'è: ordina per foto e serve a sfogliare. Questa vista serve a decidere,
e le due cose vogliono layout diversi.

#### Scenario: rami raggruppati per configurazione
- **GIVEN** una foto con 7 varianti nate da 3 configurazioni diverse
- **WHEN** si apre la vista ad albero su quella foto
- **THEN** le varianti appaiono raggruppate per configurazione, ognuna col proprio set di
  riferimenti e la ricetta
- **AND** due gruppi con gli stessi riferimenti ma preamboli diversi restano separati

#### Scenario: il voto sopravvive al ricaricamento
- **GIVEN** tre varianti marcate `tieni`, `forse`, `scarta` e una nota su una di esse
- **WHEN** la pagina viene ricaricata
- **THEN** i tre stati e la nota sono ancora quelli
- **AND** l'elenco delle `tieni` è esportabile come testo copiabile

### Requirement: LIN-03 — Dalla scelta si ripete la configurazione

Il sistema SHALL permettere, da una variante scelta, di rilanciare la stessa configurazione
(stesse sorgenti, stessi riferimenti, stessa ricetta, stesso preambolo) su altre foto o con
un seme diverso, senza riscrivere niente a mano.

#### Scenario: ripetere su un'altra foto
- **GIVEN** una variante marcata `tieni`
- **WHEN** si chiede di applicare la sua configurazione a un'altra foto del progetto
- **THEN** viene accodato un job con lo stesso set di riferimenti, ricetta e preambolo
- **AND** la nuova variante riporta un `lineage` che cita la variante di origine
