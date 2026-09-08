## ADDED Requirements

### Requirement: RAW-01 — I RAW entrano nel database

Il sistema SHALL indicizzare i formati RAW dei corpi diffusi (almeno NEF, CR2, CR3, ARW, DNG,
RAF, ORF, RW2) accanto a JPEG, PNG, HEIC e TIFF. Il formato sorgente SHALL essere registrato.

Motivazione misurata: oggi `server/importer.ts:6` accetta solo `jpg`, `jpeg` e `png`. Un RAW non
entra, quindi il culling non è rappresentabile.

#### Scenario: cartella mista
- **GIVEN** una cartella con RAW e JPEG affiancati
- **WHEN** si indicizza
- **THEN** entrambi risultano indicizzati con il proprio formato
- **AND** una coppia RAW+JPEG dello stesso scatto è riconosciuta come uno scatto solo

### Requirement: RAW-02 — L'anteprima si legge, non si ricalcola

Il sistema SHALL produrre le anteprime dall'immagine JPEG già incorporata nel RAW dalla
fotocamera, e SHALL ricorrere alla decodifica piena soltanto quando l'anteprima incorporata è
più piccola del livello richiesto.

Motivazione misurata: su 85 ARW da 47 MB la pipeline attuale a `sips` costa 1859 ms per foto;
leggere l'anteprima incorporata ne costa 7,9 in parallelo. Sono 62 minuti contro 16 secondi su
duemila scatti.

#### Scenario: la dimensione richiesta è un tetto, non una promessa
- **GIVEN** un ARW la cui anteprima incorporata è alta 1616 px
- **WHEN** si chiede il livello visore a 3840 px
- **THEN** il sistema riconosce che l'anteprima non basta
- **AND** decodifica il RAW invece di restituire 1616 px spacciandoli per 3840

#### Scenario: la misura precede la soglia
- **GIVEN** una cartella di lavoro
- **WHEN** se ne chiede la diagnosi
- **THEN** viene riportata la dimensione dell'anteprima incorporata dei file presenti
- **AND** il tempo per foto di ciascun livello, misurato su quella cartella

### Requirement: RAW-03 — Quattro livelli, con budget separati

Il sistema SHALL mantenere quattro livelli di anteprima — proxy, griglia, visore, nativo — in
cache separate, ciascuna con un proprio budget espresso in **byte** e non in numero di voci.

Motivazione misurata: a 3840 px un fotogramma decodificato pesa 39 MB contro gli 11 di 2048, e
alla risoluzione nativa di un 45 megapixel arriva a 180 MB. Una cache a conteggio non descrive
questo costo. Una cache unica farebbe litigare i livelli: scorrere una griglia da duemila scatti
sfratterebbe i proxy che rendono istantanea la striscia.

#### Scenario: nessuna casella vuota
- **GIVEN** una cartella indicizzata da poco
- **WHEN** si scorre la griglia prima che le anteprime grandi siano pronte
- **THEN** ogni cella mostra già qualcosa
- **AND** la versione grande sostituisce quella piccola quando arriva, senza sfarfallio

#### Scenario: la memoria non cresce senza limite
- **GIVEN** una cartella più grande del budget di cache
- **WHEN** la si percorre per intero
- **THEN** la memoria del processo resta entro il tetto dichiarato

### Requirement: RAW-04 — L'originale non si tocca

Il sistema SHALL NOT modificare, riscrivere o spostare i file sorgente. Un RAW aperto da
Darkroom SHALL restare identico byte per byte, anche dopo essere stato sviluppato, etichettato
o esportato.

#### Scenario: il byte è lo stesso
- **GIVEN** l'impronta crittografica di un RAW prima di aprirlo
- **WHEN** lo si etichetta, sviluppa ed esporta
- **THEN** l'impronta è invariata

### Requirement: RAW-05 — Le anteprime prodotte da Darkroom non diventano sorgenti

Il sistema SHALL escludere le proprie cartelle di anteprime dall'indicizzazione, così che un
JPEG generato da Darkroom non venga mai scambiato per lo scatto originale.

Motivazione misurata: senza questa esclusione, dalla seconda apertura di una cartella il visore
mostra l'anteprima da 1568 px al posto del RAW, e la sostituzione non è visibile.

#### Scenario: seconda apertura
- **GIVEN** una cartella già indicizzata una volta, con le anteprime scritte
- **WHEN** la si riapre
- **THEN** il numero di scatti è lo stesso della prima volta
- **AND** la sorgente di ciascuno è il file originale

### Requirement: RAW-06 — I numeri di prestazione si prendono sul binario che si consegna

Le misure di prestazione dichiarate dal sistema SHALL essere prodotte da una compilazione di
rilascio.

Motivazione misurata: sullo stesso codice, una build di sviluppo dava 7 ms dove quella di
rilascio ne dava 22.

#### Scenario: misura dichiarata
- **GIVEN** una misura di prestazione riportata dalla diagnosi
- **WHEN** la si legge
- **THEN** dichiara il tipo di compilazione con cui è stata presa
