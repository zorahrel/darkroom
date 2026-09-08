## ADDED Requirements

### Requirement: DEV-01 — Lo sviluppo avviene sulla macchina, senza rete

Il sistema SHALL sviluppare i RAW localmente, senza inviare immagini a nessun servizio, senza
modelli da scaricare e senza chiavi.

Motivazione: il ramo AI di Darkroom parla con l'esterno ed è giusto che lo faccia, ma deve
restare l'unico. Chi fa culling di un lavoro coperto da riservatezza deve poter usare tutto il
resto senza che un byte esca.

#### Scenario: nessuna chiamata di rete
- **GIVEN** una sessione di sviluppo locale su 50 scatti
- **WHEN** la si esegue con la rete disattivata
- **THEN** completa senza errori

### Requirement: DEV-02 — I cursori si salvano, le immagini no

Il sistema SHALL registrare lo sviluppo come valori di regolazione, non come immagini
sviluppate. Il file delle regolazioni SHALL nascere soltanto se qualcosa è stato sviluppato.

#### Scenario: peso delle regolazioni
- **GIVEN** 200 scatti sviluppati
- **WHEN** si guarda il file delle regolazioni
- **THEN** contiene numeri, e non immagini

### Requirement: DEV-03 — Le maschere nominano ciò che coprono

Il sistema SHALL permettere regolazioni limitate a zone riconosciute — almeno viso e cielo — e
le zone SHALL essere combinabili fra loro. Una maschera SHALL essere nominata per ciò che copre,
mai per la sua posizione nell'inquadratura.

#### Scenario: cielo senza il resto dell'azzurro
- **GIVEN** uno scatto con cielo e un'insegna blu
- **WHEN** si applica una regolazione alla zona cielo
- **THEN** l'insegna non viene toccata

#### Scenario: bordo non tagliente
- **GIVEN** una maschera su un soggetto
- **WHEN** vi si applica una regolazione forte
- **THEN** il confine non produce una linea dura né macchie sulle aree sfocate

### Requirement: DEV-04 — L'esportazione dice prima cosa farà

Il sistema SHALL esportare in una cartella scelta dall'utente, e SHALL dichiarare prima quanti
file, dove e quanto spazio occuperanno. Accanto ai RAW SHALL NOT finire nulla.

#### Scenario: dichiarazione prima della scrittura
- **GIVEN** 340 scatti da esportare
- **WHEN** si avvia l'esportazione
- **THEN** numero, destinazione e peso stimato sono mostrati prima che il primo file sia scritto

### Requirement: DEV-05 — La resa portabile si confronta con quella di sistema

Finché la pipeline di sviluppo portabile non è dichiarata equivalente, il sistema SHALL poter
usare la pipeline RAW del sistema operativo dietro la stessa interfaccia, e la scelta SHALL
essere un solo punto nel codice.

L'equivalenza SHALL essere dimostrata confrontando le immagini prodotte, non descritta a parole.

#### Scenario: confronto a immagine
- **GIVEN** lo stesso RAW e le stesse regolazioni
- **WHEN** viene sviluppato dalle due pipeline
- **THEN** la differenza fra i due risultati è sotto la soglia dichiarata
- **AND** la misura è un artefatto salvato, non un giudizio

### Requirement: DEV-06 — Un bersaglio si misura sulla pipeline che lo applicherà

Ogni soglia o valore di riferimento usato per proporre una regolazione SHALL essere misurato
sulla stessa pipeline che poi la applica, e SHALL dichiarare su quale materiale è stato tarato.

Motivazione misurata: il bersaglio di esposizione della pelle era stato ricavato dagli export
Camera Raw del fotografo, che portano anche il suo grading — numero giusto, scala sbagliata. Lo
stesso valore, misurato su un servizio in bianco e nero scuro, dà 36 invece di 118.

#### Scenario: taratura dichiarata
- **GIVEN** una proposta automatica di regolazione
- **WHEN** se ne chiede la provenienza
- **THEN** viene dichiarato su quale materiale e con quale pipeline la soglia è stata tarata

### Requirement: DEV-07 — Una maschera si approva guardandola, non contandola

Il sistema SHALL produrre, per ogni tipo di maschera, un provino ingrandito ispezionabile da un
umano. La percentuale di copertura SHALL NOT essere l'unico criterio di accettazione.

Motivazione misurata: la prima maschera del volto superava tutti i controlli automatici di
copertura pur avendo buchi larghi quanto la faccia, mascella poligonale e fronte dentro i
capelli. La percentuale era corretta e non descriveva la forma.

#### Scenario: provino disponibile
- **GIVEN** una maschera generata
- **WHEN** se ne chiede la verifica
- **THEN** viene prodotto un provino ingrandito, salvato come artefatto

### Requirement: DEV-08 — Le maschere si compongono in spazio gamma

Il sistema SHALL eseguire inversione e composizione delle maschere sui valori scritti, non sui
valori lineari.

Motivazione misurata: in spazio lineare il complemento di 128 usciva 229, e la somma di due
maschere raggiungeva 375 su 255.

#### Scenario: inversione corretta
- **GIVEN** una maschera con valore intermedio
- **WHEN** la si inverte
- **THEN** il valore invertito più l'originale danno il valore pieno
