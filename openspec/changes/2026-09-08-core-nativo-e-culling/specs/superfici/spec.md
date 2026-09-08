## ADDED Requirements

### Requirement: SUP-01 — Una sola interfaccia, due gusci

Il sistema SHALL servire la versione web e l'applicazione desktop con **la stessa** base di
interfaccia. Una funzionalità aggiunta SHALL comparire in entrambe senza essere scritta due
volte.

Motivazione: la richiesta è esplicitamente una cosa sola con due superfici. Due interfacce che
si assomigliano divergono al primo giorno in cui una delle due ha fretta.

#### Scenario: una funzione, due superfici
- **GIVEN** una funzionalità aggiunta all'interfaccia
- **WHEN** si aprono la versione web e l'app desktop
- **THEN** è presente in entrambe
- **AND** non esiste un secondo componente che la implementa di nuovo

### Requirement: SUP-02 — Nell'app il percorso caldo non attraversa la rete

Nell'applicazione desktop il sistema SHALL ottenere le anteprime dal core nello stesso processo,
senza passare da HTTP.

#### Scenario: nessuna porta nel percorso anteprime
- **GIVEN** l'app desktop in esecuzione
- **WHEN** si scorre una griglia da duemila scatti
- **THEN** nessuna richiesta HTTP viene emessa per le anteprime

### Requirement: SUP-03 — Il culling e la rifinitura AI sono un flusso solo

Il sistema SHALL permettere di passare dagli scatti tenuti nel culling alla rifinitura AI senza
esportare e reimportare a mano.

Motivazione: è la giuntura che giustifica l'unione. Se per portare 340 scelte nel ramo AI serve
un giro su disco, sono rimasti due programmi in una finestra sola.

#### Scenario: passaggio diretto
- **GIVEN** una selezione di scatti tenuti
- **WHEN** la si manda alla rifinitura
- **THEN** entrano nella coda AI senza copie manuali
- **AND** conservano il collegamento allo scatto di origine

### Requirement: SUP-04 — La versione web dichiara ciò che non può fare

La versione web SHALL dichiarare esplicitamente le operazioni che richiedono l'accesso ai file
locali e che nel browser non sono disponibili, invece di offrirle e fallire.

#### Scenario: operazione non disponibile
- **GIVEN** la versione web aperta su un browser
- **WHEN** si guarda un'azione che richiede l'accesso diretto al disco
- **THEN** è dichiarata come disponibile nell'app desktop
- **AND** non viene presentata come se potesse riuscire

### Requirement: SUP-05 — Il peso dell'applicazione è dichiarato e sorvegliato

Il sistema SHALL misurare la dimensione del pacchetto dell'applicazione desktop e la memoria a
riposo, e SHALL trattarle come misure sorvegliate.

Motivazione misurata: l'alternativa Electron è stata scartata su 220 MB di pacchetto contro 4,9.
Un numero che ha deciso un'architettura merita di essere guardato mentre cambia.

#### Scenario: misura registrata
- **GIVEN** una compilazione dell'app
- **WHEN** la si produce
- **THEN** dimensione del pacchetto e memoria a riposo sono riportate come numeri
