## ADDED Requirements

### Requirement: CULL-01 — Si giudica con la tastiera, non con il mouse

Il sistema SHALL permettere di assegnare etichette colore e stelle allo scatto mostrato con la
sola tastiera, e di passare allo scatto successivo senza staccare le mani.

Motivazione: il culling è la fase in cui da qualche migliaio di scatti se ne scelgono qualche
centinaio. Un giudizio che costa un movimento del mouse costa migliaia di movimenti.

#### Scenario: giudizio e avanzamento
- **GIVEN** uno scatto aperto nel visore
- **WHEN** si preme il tasto di un'etichetta
- **THEN** l'etichetta viene assegnata e l'avanzamento allo scatto successivo è immediato

#### Scenario: la ripetizione del tasto non si accumula
- **GIVEN** un tasto tenuto premuto
- **WHEN** la ripetizione automatica del sistema parte
- **THEN** non vengono assegnati giudizi che l'utente non ha inteso dare

### Requirement: CULL-02 — Gli scatti a raffica si guardano insieme

Il sistema SHALL raggruppare automaticamente gli scatti consecutivi che appartengono alla stessa
raffica, e SHALL permettere di correggere a mano un raggruppamento sbagliato.

Le correzioni manuali SHALL essere le uniche cose registrate: un file di gruppi SHALL nascere
soltanto se qualcuno corregge qualcosa, e SHALL contenere solo le decisioni prese a mano.

#### Scenario: correzione conservata
- **GIVEN** due scatti che il sistema ha messo nello stesso gruppo
- **WHEN** l'utente li separa
- **AND** riapre la cartella
- **THEN** restano separati

#### Scenario: nessuna correzione, nessun file
- **GIVEN** una cartella in cui nessun gruppo è stato corretto
- **WHEN** si chiude la sessione
- **THEN** nella cartella di lavoro non compare alcun file di gruppi

### Requirement: CULL-03 — I criteri sono di questa sessione e di nessun'altra

Il sistema SHALL richiedere criteri espliciti per ogni nuovo lavoro di culling e SHALL NOT
riutilizzare automaticamente i criteri di un lavoro precedente.

Motivazione: i criteri di un matrimonio non sono quelli di un reportage. Riproporli è una
scorciatoia che produce scelte sbagliate con l'aria di essere già decise.

#### Scenario: nessuna eredità
- **GIVEN** un lavoro concluso con criteri scritti
- **WHEN** si apre una cartella nuova
- **THEN** i criteri sono vuoti e vengono chiesti

### Requirement: CULL-04 — Le scelte si raccolgono, e sanno tornare indietro

Il sistema SHALL raccogliere gli scatti scelti in una cartella dedicata dentro la cartella di
lavoro, e SHALL permettere di annullare la raccolta riportando la cartella allo stato precedente.

#### Scenario: raccolta e ritorno
- **GIVEN** una selezione raccolta in cartella
- **WHEN** si annulla la raccolta
- **THEN** la cartella di lavoro torna al numero di file che aveva prima
- **AND** nessun originale è stato spostato o perso

### Requirement: CULL-05 — Si cerca per quello che c'è dentro la fotografia

Il sistema SHALL permettere di filtrare gli scatti per contenuto visivo riconosciuto, e SHALL
dichiarare quando l'analisi non è ancora stata eseguita invece di restituire zero risultati.

#### Scenario: analisi non eseguita
- **GIVEN** una cartella su cui l'analisi del contenuto non è mai girata
- **WHEN** si cerca una parola
- **THEN** il sistema dice che l'analisi manca
- **AND** non presenta l'assenza di risultati come «nessuna corrispondenza»

### Requirement: CULL-06 — Il conto di fine lavoro

Il sistema SHALL produrre, su richiesta, un rendiconto del culling: quanti scatti esaminati,
quanti tenuti, quanti scartati, con quali criteri e in quanto tempo.

#### Scenario: rendiconto coerente
- **GIVEN** un culling concluso
- **WHEN** se ne chiede il rendiconto
- **THEN** i tenuti più gli scartati più i non giudicati sono pari al totale indicizzato
