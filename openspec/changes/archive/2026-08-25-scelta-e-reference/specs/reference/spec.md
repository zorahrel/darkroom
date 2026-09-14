## ADDED Requirements

### Requirement: REF-01 — Una reference si aggiunge al progetto e ha un ruolo dichiarato

Il sistema SHALL permettere di aggiungere un'immagine di riferimento a un progetto,
assegnandole un ruolo esplicito fra `stile` (un'immagine da cui prendere luce, taglio e
trattamento, mai il volto) e `identità` (una foto della stessa persona del soggetto). Il
ruolo SHALL determinare il preambolo usato nel prompt.

Motivazione misurata: nella cartella dell'utente convivevano tre foto sue e un'immagine di
stile di un'altra persona. Allegate senza distinzione, il modello media i volti; dichiarate
solo come identità, il modello ignora l'aspetto delle reference — ed è successo, per una
passata intera di 46 varianti.

#### Scenario: reference di stile
- **GIVEN** un'immagine aggiunta con ruolo `stile`
- **WHEN** viene allegata a una generazione
- **THEN** il prompt dichiara che quel volto non va copiato e che se ne prendono solo luce,
  tonalità, inquadratura e trattamento

#### Scenario: la cartella dell'utente non viene modificata
- **GIVEN** una reference importata da una cartella fuori dal progetto
- **WHEN** viene aggiunta
- **THEN** viene copiata dentro il progetto
- **AND** la cartella di origine resta esattamente com'era, per numero e contenuto dei file

### Requirement: REF-02 — Dal riferimento si estrae il prompt che lo descrive

Il sistema SHALL produrre, da un'immagine di riferimento, una descrizione testuale
riutilizzabile come ricetta: luce, tonalità, inquadratura, resa della pelle, trattamento.
La descrizione SHALL essere modificabile a mano prima di diventare una ricetta, e SHALL
restare associata alla reference da cui è nata.

#### Scenario: estrazione e riuso
- **GIVEN** una reference di stile appena aggiunta
- **WHEN** si chiede l'estrazione del prompt
- **THEN** viene proposto un testo che descrive luce, taglio e trattamento di quell'immagine
- **AND** salvandolo diventa una ricetta selezionabile come le altre
- **AND** la ricetta cita la reference di provenienza

#### Scenario: l'estrazione fallisce
- **GIVEN** un'estrazione che non produce testo utile
- **WHEN** l'operazione termina
- **THEN** viene detto che non è riuscita
- **AND** non viene salvata una ricetta vuota o un testo generico di ripiego

### Requirement: REF-03 — Una passata scartata si archivia, non si cancella

Il sistema SHALL spostare in `data/archive/<configurazione>/` le varianti rimosse da un
progetto, mantenendo i file su disco.

Motivazione: una passata scartata è la prova di cosa non funziona, e ricrearla costa quanto
è costata. Il 25/08 sono state archiviate 146 immagini in questo modo, tutte recuperabili.

#### Scenario: rimozione di una configurazione
- **GIVEN** 97 varianti nate da un set di riferimenti sbagliato
- **WHEN** vengono rimosse dal progetto
- **THEN** i file finiscono in `data/archive/` raggruppati per configurazione
- **AND** spariscono dal progetto e dalle sue viste
- **AND** nessun file viene eliminato dal disco
