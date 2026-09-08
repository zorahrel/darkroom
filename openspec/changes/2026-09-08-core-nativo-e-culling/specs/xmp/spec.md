## ADDED Requirements

### Requirement: XMP-01 — Il sidecar sta accanto al RAW e porta il suo nome

Il sistema SHALL scrivere i giudizi in file XMP posti accanto al RAW corrispondente, con lo
stesso nome di base, così che gli altri programmi di sviluppo li trovino.

#### Scenario: nome e posizione
- **GIVEN** un RAW `DSC09494.ARW`
- **WHEN** se ne scrivono i giudizi
- **THEN** nasce `DSC09494.xmp` nella stessa cartella

### Requirement: XMP-02 — Non si sovrascrive senza backup e senza aver letto

Il sistema SHALL NOT sovrascrivere un XMP esistente. Prima di scrivere, SHALL salvarne una copia
in una cartella di backup dedicata, SHALL leggerne il contenuto, SHALL modificare soltanto i
campi di propria competenza e SHALL validare il risultato prima di sostituire l'originale.

Motivazione: un XMP scritto da Lightroom contiene sviluppo, ritagli e cronologia che non ci
appartengono. Riscriverlo per intero significa cancellare il lavoro di qualcun altro.

#### Scenario: campi altrui preservati
- **GIVEN** un XMP che contiene impostazioni di sviluppo di un altro programma
- **WHEN** Darkroom vi scrive un'etichetta colore
- **THEN** l'etichetta è presente
- **AND** le impostazioni dell'altro programma sono invariate
- **AND** una copia del file precedente esiste nella cartella di backup

#### Scenario: scrittura interrotta
- **GIVEN** una scrittura che fallisce a metà
- **WHEN** si riapre la cartella
- **THEN** non esiste alcun XMP troncato: o il vecchio, o il nuovo

### Requirement: XMP-03 — La scrittura è un atto richiesto

Il sistema SHALL scrivere i sidecar soltanto su richiesta esplicita, e SHALL dichiarare prima
quanti file scriverà e dove.

#### Scenario: conferma informata
- **GIVEN** 340 scatti giudicati
- **WHEN** si chiede la scrittura dei sidecar
- **THEN** viene detto quanti file verranno scritti e in quale cartella, prima di scriverli

### Requirement: XMP-04 — Lo scanner tocca solo la descrizione che dichiara il proprio prefisso

Il sistema SHALL limitare lettura e scrittura all'elemento `rdf:Description` che dichiara il
prefisso `xmp:`, e SHALL NOT operare per ricerca testuale sull'intero file.

Motivazione misurata: gli stessi nomi di campo compaiono dentro le cronologie di Camera Raw.
Una ricerca sull'intero file legge e riscrive anche quelle, cioè altera la storia di sviluppo
di qualcun altro.

#### Scenario: cronologia intatta
- **GIVEN** un XMP con una cronologia Camera Raw che contiene gli stessi nomi di campo
- **WHEN** Darkroom vi scrive un'etichetta
- **THEN** la cronologia è invariata byte per byte

### Requirement: XMP-05 — L'etichetta è scritta nel vocabolario che l'utente leggerà

Il sistema SHALL scrivere il valore di `xmp:Label` nel vocabolario della lingua in cui l'utente
usa il proprio programma di sviluppo, e SHALL dichiarare quale vocabolario sta usando.

Motivazione misurata: con Camera Raw in italiano le etichette valide sono Seleziona, Secondo,
Approvato, Da rivedere, Da fare — non i nomi inglesi. Scritte in inglese, il colore non compare.

#### Scenario: etichetta visibile nel programma di sviluppo
- **GIVEN** un XMP scritto da Darkroom con vocabolario italiano
- **WHEN** lo si apre in Camera Raw in italiano
- **THEN** l'etichetta colore è quella assegnata
