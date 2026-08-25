## ADDED Requirements

### Requirement: GEN-01 — Un job può avere più foto sorgente

Il sistema SHALL accettare per un job un elenco ordinato di foto sorgente (`input_paths`),
non una sola. Tutte le sorgenti SHALL essere allegate alla stessa richiesta, e il prompt
SHALL dichiarare che si tratta della stessa persona ripresa in scatti diversi.

Distinzione che il modello dei dati oggi non fa e che serve: una foto **sorgente** è materiale
da cui produrre il risultato; un **riferimento** è un bersaglio da assomigliare. Tre ritratti
della stessa persona come input contemporaneo sono il primo caso, non il secondo.

#### Scenario: tre scatti come unico input
- **GIVEN** tre foto della stessa persona in un progetto
- **WHEN** viene accodato un job con tutte e tre come sorgenti e una ricetta
- **THEN** la richiesta allega tre immagini più gli eventuali riferimenti
- **AND** la versione prodotta è collegata a tutte e tre le foto
- **AND** compare nella vista ad albero sotto ciascuna delle tre

#### Scenario: compatibilità con i job a sorgente singola
- **GIVEN** un job accodato dall'interfaccia esistente con una sola foto
- **WHEN** viene lavorato
- **THEN** si comporta esattamente come prima di questo change

### Requirement: GEN-02 — Il risultato non può essere uno degli allegati

Il sistema SHALL confrontare l'immagine ricevuta con ogni file allegato (sorgenti e
riferimenti) e SHALL far fallire il job quando la correlazione strutturale con uno di essi
supera 0.9, indicando quale.

Modo di fallire reale, non ipotetico: il 24/08/2026 il worker CDP ha scaricato **222 volte**
il riferimento cromatico al posto del render. Il worker HTTP è nato senza questo controllo.

#### Scenario: torna indietro un allegato
- **GIVEN** una generazione che restituisce un'immagine identica a un riferimento allegato
- **WHEN** il worker la verifica
- **THEN** il job fallisce con scritto quale allegato è tornato indietro
- **AND** il file non viene registrato come versione

#### Scenario: un ritaglio legittimo non viene bocciato
- **GIVEN** una ricetta che cambia l'inquadratura (ritaglio quadrato)
- **WHEN** il risultato ha correlazione 0.03 con la foto sorgente
- **THEN** il job riesce
- **AND** nessun controllo sulla somiglianza alla sorgente lo blocca

*(La soglia sulla somiglianza alla sorgente è deliberatamente assente: misurato il 25/08, un
ritaglio quadrato corretto scende a 0.03, e un cancello su quel numero boccerebbe il lavoro
giusto. Il controllo che resta è quello che ha una risposta univoca.)*

### Requirement: GEN-03 — I file generati seguono la convenzione dell'interfaccia

Il sistema SHALL nominare ogni file generato `v<NN>.png` in base al numero di versione.

Motivazione: l'interfaccia ricostruisce l'URL dal numero di versione e non legge
`image_path` dal database. Un nome diverso rende l'immagine irraggiungibile dalla UI mentre
ogni richiesta diretta risponde 200 — difetto invisibile da riga di comando, visto il 25/08
su 17 varianti.

#### Scenario: anteprima raggiungibile
- **GIVEN** una variante appena generata come versione 7 della foto `X`
- **WHEN** l'interfaccia chiede `/thumb/gen/X/v07.png`
- **THEN** risponde l'immagine appena prodotta
