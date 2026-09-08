## ADDED Requirements

### Requirement: VID-01 — Il girato si sfoltisce, non si monta

Il sistema SHALL permettere di scorrere una cartella di riprese, tenere o scartare ogni clip,
segnare dove attacca e dove stacca, e riordinare le clip tenute. Il sistema SHALL NOT produrre
un montaggio finito: il materiale sfoltito esce verso il programma con cui si monta.

#### Scenario: due viste sullo stesso materiale
- **GIVEN** una cartella di clip
- **WHEN** la si apre
- **THEN** è disponibile una griglia delle clip e una fila con anteprima e timeline

### Requirement: VID-02 — Le scelte stanno accanto alle clip, le clip non si toccano

Il sistema SHALL registrare le scelte sul girato in un file posto accanto alle riprese,
contenente le decisioni e non le riprese. I file video SHALL restare invariati.

#### Scenario: nessuna riscrittura del girato
- **GIVEN** l'impronta di una clip prima della sessione
- **WHEN** la si tiene, se ne segna il taglio e la si riordina
- **THEN** l'impronta della clip è invariata

### Requirement: VID-03 — Una fila muta dice perché

Il sistema SHALL permettere di silenziare la riproduzione, e quando una fila non produce audio
SHALL dichiararne il motivo invece di restare muta senza spiegazione.

#### Scenario: silenzio spiegato
- **GIVEN** una fila di clip senza traccia audio
- **WHEN** la si riproduce
- **THEN** il sistema dichiara che le clip non hanno audio

### Requirement: VID-04 — Le scelte si scrivono prima di chiudere

Il sistema SHALL salvare le scelte sul girato prima di chiudere la vista e prima di uscire
dall'applicazione, anche quando l'uscita non è stata chiesta dalla vista stessa.

#### Scenario: uscita dall'applicazione
- **GIVEN** scelte non ancora salvate
- **WHEN** si esce dall'applicazione
- **THEN** le scelte sono sul disco alla riapertura
