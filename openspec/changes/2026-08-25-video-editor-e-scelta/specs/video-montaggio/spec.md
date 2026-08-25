## ADDED Requirements

### Requirement: MON-01 — La timeline sa degli atti

Il sistema SHALL mostrare sopra la linea del tempo gli **atti** del montaggio con i loro
confini e i loro nomi, letti da `atti.json` prodotto dal pianificatore.

Motivazione: la timeline oggi mostra 64 blocchi indistinguibili. Il montaggio invece è una
storia in nove atti (vuoto, cammino, richiamo, acqua, stacco, sospesa, volo, oceano), e i
confini non sono a gusto — sono i confini di sezione del brano più i due crolli di durezza
misurati. Senza gli atti in pagina, chi guarda non ha modo di vedere se la storia regge.

#### Scenario: atti in pagina
- **GIVEN** un progetto con `atti.json`
- **WHEN** si apre la pagina di montaggio
- **THEN** sopra la timeline compaiono le bande degli atti, nominate
- **AND** un clic su una banda porta la riproduzione all'inizio di quell'atto

#### Scenario: progetto senza atti
- **GIVEN** un progetto video il cui pianificatore non scrive `atti.json`
- **WHEN** si apre la pagina
- **THEN** la timeline funziona senza le bande
- **AND** non viene inventata una divisione in atti

### Requirement: MON-02 — Ogni taglio dice perché è lì

Il sistema SHALL mostrare, per il taglio selezionato: il piano scelto, la durezza del suono
in quel punto, la durezza misurata del piano, l'atto, e l'origine della ripresa.

Chi guarda un taglio che non gli piace deve poter distinguere tre casi diversi: la ripresa
è brutta, la ripresa è bella ma sta nel punto sbagliato, oppure l'atto non ammetteva niente
di meglio. Sono tre azioni diverse e oggi si confondono.

#### Scenario: taglio selezionato
- **GIVEN** un montaggio caricato
- **WHEN** si clicca su un blocco della timeline
- **THEN** compare il pannello con piano, durezza suono, durezza piano, atto e origine

### Requirement: MON-03 — Forzature mirate, scritte dove il Python le legge

Il sistema SHALL permettere tre forzature su un taglio: **inchiodare** un altro piano
ammissibile, **cambiare la durata** del blocco, **escludere** il piano. Le forzature SHALL
essere scritte in `scelte.json` nei campi `pin` e `durata`, e SHALL essere lette dal
pianificatore alla ricostruzione successiva.

Il sistema SHALL NOT offrire riordino libero dei tagli né trim fotogramma per fotogramma:
le garanzie del progetto (tagli su beat misurato, ρ ≥ 0.85, zero doppioni) sono
conseguenza del fatto che il montaggio è derivato, e un montaggio a mano le rimuove senza
che nessuna misura possa più difenderle.

#### Scenario: inchiodare un piano
- **GIVEN** il taglio a 1:55 con il piano `w_rasa`
- **WHEN** si inchioda `w_specchio` al suo posto e si ricostruisce
- **THEN** il piano montato usa `w_specchio` in quel taglio
- **AND** le altre condizioni della barra restano verdi, o la pagina dice quale è caduta

#### Scenario: forzatura che romperebbe una garanzia
- **GIVEN** una forzatura che porterebbe due pezzi della stessa presa a meno di sei stacchi
- **WHEN** si ricostruisce
- **THEN** la ricostruzione avviene comunque
- **AND** la pagina segnala quale garanzia è stata sospesa e su quale taglio

### Requirement: MON-04 — La barra si legge in pagina, e non è una seconda implementazione

Il sistema SHALL eseguire `check.py` del progetto e SHALL mostrarne le condizioni con i
valori misurati. Il sistema SHALL NOT ricalcolare quelle condizioni per conto proprio.

Motivazione misurata: una condizione della barra ha misurato per due mesi la cosa
sbagliata — contava i fotogrammi identici e usciva 0%, ma solo perché la grana a 20
copriva i quadri tenuti; abbassata la grana è diventata rossa sul video migliore. Una
seconda implementazione dello stesso controllo avrebbe nascosto anche quello.

#### Scenario: barra verde
- **GIVEN** un montaggio che passa tutte le condizioni
- **WHEN** si apre la pagina
- **THEN** le condizioni compaiono in verde, ognuna col suo valore misurato

#### Scenario: barra rossa
- **GIVEN** un montaggio con ρ sotto soglia
- **WHEN** si apre la pagina
- **THEN** quella condizione compare in rosso col valore e la soglia
- **AND** le altre restano leggibili

### Requirement: MON-05 — Ricostruire dal browser

Il sistema SHALL offrire un comando che lancia la ricostruzione del montaggio, SHALL
mostrare il log mentre scorre, e SHALL mostrare il verdetto della barra alla fine. Una
sola ricostruzione per progetto SHALL poter essere in corso alla volta.

#### Scenario: ricostruzione
- **GIVEN** scarti e forzature appena registrati
- **WHEN** si preme ricostruisci
- **THEN** il log scorre in pagina
- **AND** a fine corsa la barra si aggiorna da sola

#### Scenario: seconda ricostruzione durante la prima
- **GIVEN** una ricostruzione in corso
- **WHEN** si preme di nuovo ricostruisci
- **THEN** il comando è rifiutato con un messaggio
- **AND** la ricostruzione in corso non viene interrotta
