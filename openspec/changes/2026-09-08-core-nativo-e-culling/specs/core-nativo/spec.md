## ADDED Requirements

### Requirement: CORE-01 — Il core non dipende da alcun sistema operativo

Il sistema SHALL fornire un core in Rust che espone RAW, anteprime, cache, XMP, grade e firme
percettive senza chiamare API specifiche di macOS. Il core SHALL compilare ed eseguire i propri
test su macOS e su Windows.

Motivazione misurata: l'implementazione di riferimento è vincolata a macOS da `ImageIO`,
`CIRAWFilter`, `Vision` e `AVFoundation`. Fin che il core resta lì, non esistono né la versione
web né il PC come macchina d'uso.

#### Scenario: stessa risposta su due sistemi
- **GIVEN** lo stesso RAW e la stessa richiesta di anteprima
- **WHEN** il core gira su macOS e su Windows
- **THEN** produce immagini con le stesse dimensioni
- **AND** la differenza percettiva fra le due è sotto la soglia dichiarata dal confronto pixel

#### Scenario: nessuna API di sistema nel percorso caldo
- **GIVEN** il crate del core
- **WHEN** lo si compila per un target non-Apple
- **THEN** la compilazione riesce senza feature condizionali sul percorso anteprime

### Requirement: CORE-02 — Un solo core, due modi di chiamarlo

Il sistema SHALL esporre il core al backend Bun e all'applicazione desktop senza duplicare la
logica. Il backend SHALL chiamarlo attraverso un confine di processo o FFI; l'applicazione
desktop SHALL chiamarlo in-process, senza salto HTTP nel percorso caldo.

#### Scenario: la stessa anteprima da due strade
- **GIVEN** la stessa foto
- **WHEN** l'anteprima viene chiesta dalla versione web e dall'app desktop
- **THEN** i byte prodotti sono identici

### Requirement: CORE-03 — Un file malformato è un errore, non un comportamento

Il sistema SHALL trattare ogni file in ingresso come non fidato. Un RAW troncato, con
intestazione incoerente o con offset che puntano fuori dal file SHALL produrre un errore
dichiarato, senza panico, senza lettura fuori dai limiti e senza consumo di memoria
proporzionale a un valore letto dal file.

Motivazione: il percorso caldo parsa strutture TIFF scritte da terzi. È l'unico punto del
progetto dove un file di un cliente tocca un parser binario.

#### Scenario: RAW troncato
- **GIVEN** un RAW tagliato a metà
- **WHEN** se ne chiede l'anteprima
- **THEN** il core restituisce un errore che nomina il file
- **AND** l'indicizzazione della cartella prosegue sugli altri file

#### Scenario: offset che punta oltre la fine
- **GIVEN** un file il cui IFD dichiara un'anteprima oltre la dimensione del file
- **WHEN** se ne chiede l'anteprima
- **THEN** il core rifiuta senza leggere fuori dai limiti

### Requirement: CORE-04 — Il decoder sta in un processo sacrificabile

Il sistema SHALL eseguire la decodifica piena dei RAW in un processo separato dal proprio, in
modo che un file che fa morire il decoder non porti giù l'applicazione né la sessione di lavoro.

Motivazione misurata: il decoder RAW di sistema, su file corrotti, termina il processo con
`EXC_BREAKPOINT` invece di restituire un errore, e l'intestazione del file non permette di
prevederlo. L'isolamento costa il 5-7% su un ridisegno e fa scendere il picco di memoria da
644 a 310 MB.

#### Scenario: il decoder muore, l'applicazione no
- **GIVEN** un RAW che fa terminare il decoder
- **WHEN** se ne chiede la decodifica piena
- **THEN** l'applicazione resta viva e segnala quel file come illeggibile
- **AND** il lavoro non salvato non viene perso

### Requirement: CORE-05 — Un'immagine illeggibile non è mai l'immagine precedente

Il sistema SHALL NOT restituire il contenuto di uno scatto diverso da quello richiesto. Quando
la decodifica non riesce, il risultato SHALL essere un errore dichiarato.

Motivazione misurata: a pipeline calda un RAW corrotto restituisce l'immagine decodificata
prima — stesso soggetto, posa diversa. Non ha l'aspetto di un guasto, quindi si giudica uno
scatto guardandone un altro. È il difetto più grave del catalogo perché è invisibile.

#### Scenario: nessuna contaminazione fra scatti
- **GIVEN** una sequenza in cui uno scatto corrotto segue uno scatto valido
- **WHEN** si scorre dall'uno all'altro
- **THEN** lo scatto corrotto è dichiarato illeggibile
- **AND** non viene mostrato il contenuto dello scatto precedente

#### Scenario: una notturna non è un errore
- **GIVEN** uno scatto notturno legittimo, la cui luminosità media è prossima a zero
- **WHEN** lo si apre
- **THEN** viene mostrato normalmente
