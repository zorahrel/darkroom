## ADDED Requirements

### Requirement: SCE-01 — Una scena alla volta, a tutto quadro

Il sistema SHALL offrire una vista che mostra **una sola ripresa per volta**, in 9:16, che
parte da sola e va in loop, con accanto: l'atto a cui appartiene, i secondi che sta in
scena, il minuto del montaggio in cui cade, e il prompt che l'ha generata.

Motivazione misurata: nella griglia attuale due riprese verticali affiancate dentro una
tessera fanno ~80 px l'una, e a quella dimensione i difetti che contano non si vedono — il
buco bianco sulla schiena di `g_scal1` è stato trovato solo aprendo la ripresa a 250 px di
larghezza, dopo che era già passata due volte in griglia.

#### Scenario: scena mai giudicata
- **GIVEN** un progetto video con riprese non ancora giudicate
- **WHEN** si apre la vista di scelta
- **THEN** compare la prima ripresa non giudicata, già in riproduzione
- **AND** sono visibili atto, secondi in scena, minuto di montaggio e prompt

#### Scenario: ripresa che non entra nel montaggio corrente
- **GIVEN** una ripresa girata ma non usata dal piano
- **WHEN** compare nella vista di scelta
- **THEN** al posto del minuto compare "non in montaggio"
- **AND** la ripresa resta giudicabile

### Requirement: SCE-02 — Tieni, scarta, annota — da tastiera

Il sistema SHALL accettare il giudizio con `←` scarta, `→` tieni, `↑` annota, `spazio`
rivedi, e SHALL avanzare alla scena successiva dopo tieni e scarta. La nota SHALL essere
testo libero e SHALL poter accompagnare sia uno scarto sia una conferma.

Una nota non è un verdetto: «si rompono le gambe» detto su una ripresa tenuta è
l'istruzione per il giro dopo, non un motivo per buttarla adesso.

#### Scenario: scarto con motivo
- **GIVEN** la scena `d02` in vista
- **WHEN** si preme `←` e si scrive "si scioglie nell'onda dal fotogramma 90"
- **THEN** `scelte.json` riporta `d02` fra gli scartati con quel motivo
- **AND** la vista passa alla scena successiva

#### Scenario: ripensamento
- **GIVEN** una ripresa già scartata
- **WHEN** la si richiama col filtro "scartati" e si preme `→`
- **THEN** torna disponibile al pianificatore
- **AND** il motivo precedente resta leggibile nello storico della ripresa

### Requirement: SCE-03 — La coda si può restringere

Il sistema SHALL permettere di filtrare la coda per atto, per "solo quelle in montaggio", e
per "solo scartate". Il filtro SHALL essere visibile insieme al numero di scene che restano
da giudicare.

#### Scenario: giudicare solo il volo
- **GIVEN** 272 riprese di cui 18 nell'atto del volo
- **WHEN** si sceglie il filtro per atto "volo"
- **THEN** la coda contiene solo quelle 18
- **AND** il contatore lo dice

### Requirement: SCE-04 — Le due metà della stessa presa non sono due scene

Il sistema SHALL raggruppare per **origine** — il nome della ripresa senza le cifre finali —
e SHALL mostrare i pezzi della stessa presa insieme, non come scene indipendenti.

Motivazione misurata: il montaggio dichiarava 122 riprese diverse e le origini erano 48;
quarantanove volte due pezzi della stessa presa passavano a meno di otto secondi l'uno
dall'altro, due a mezzo secondo. Chi giudica `z43_0` sta giudicando anche `z43_1`.

#### Scenario: presa in due pezzi
- **GIVEN** le riprese `z43_0` e `z43_1`
- **WHEN** compaiono nella vista di scelta
- **THEN** appaiono come una sola scena con due spezzoni riproducibili
- **AND** un giudizio dato sulla scena vale per entrambi gli spezzoni, salvo scelta esplicita
