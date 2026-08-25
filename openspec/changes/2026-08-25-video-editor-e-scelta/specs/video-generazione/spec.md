## ADDED Requirements

### Requirement: GEN-01 — Rigenerare una scena dal suo giudizio

Il sistema SHALL permettere, da una scena giudicata, di aprire il prompt che l'ha
generata, modificarlo, e lanciare una nuova generazione sulla GPU del progetto. La nota
lasciata sulla scena SHALL essere visibile mentre si modifica il prompt.

È il ciclo che oggi si chiude a mano: la nota dice cosa non va, il prompt è il posto dove
si corregge, e i due stanno in due finestre diverse.

#### Scenario: rigenerazione da uno scarto
- **GIVEN** la scena `w_nubi` scartata con nota "esce in piedi, non distesa"
- **WHEN** si apre il prompt, si aggiunge un movimento di macchina e si lancia
- **THEN** compare un job in coda con quel prompt
- **AND** la nota resta leggibile accanto al prompt mentre lo si modifica

### Requirement: GEN-02 — I limiti della macchina sono campi, non costanti nascoste

Il sistema SHALL esporre risoluzione, numero di fotogrammi, passi e decodifica a tasselli
come parametri visibili del job, con default che stanno dentro la memoria della GPU.

Motivazione misurata: sulla 3090 da 24 GB, una generazione a 704×1280 con 81 fotogrammi
**senza immagine di partenza** occupa 23,9 GB su 24,5 e non produce nulla — un'ora al 100%
di GPU e zero PNG. La stessa richiesta a 640×1152, 61 fotogrammi, 20 passi e decodifica a
tasselli da 256 esce in **90 secondi**. La differenza non è il metodo, è la memoria, e chi
lancia deve poterla vedere.

#### Scenario: default che sta in memoria
- **GIVEN** un nuovo job di generazione video
- **WHEN** si apre il pannello
- **THEN** i parametri sono precompilati a 640×1152 / 61 fotogrammi / 20 passi / tasselli 256
- **AND** sono tutti modificabili

#### Scenario: generazione che non produce nulla
- **GIVEN** un job che dopo il tempo previsto non ha prodotto fotogrammi
- **WHEN** il worker se ne accorge
- **THEN** il job va in errore con il tempo trascorso e i parametri usati
- **AND** non resta appeso come "in corso"

### Requirement: GEN-03 — I fotogrammi tornano dentro al progetto

A generazione riuscita, il sistema SHALL riportare i fotogrammi nella cartella del piano,
SHALL produrre l'anteprima leggera, e SHALL rendere la nuova ripresa disponibile alla vista
di scelta senza passaggi manuali.

I fotogrammi SHALL restare sulla macchina che li ha generati. Raccolta,
interpolazione e anteprima avvengono la', e il collegamento SHALL portare solo la
clip leggera.

La forma precedente — codifica a crf 10 sul PC, un solo scp, decodifica e
interpolazione sul Mac — era gia' venti volte meglio del mandare 61 PNG, ma
restava un giro completo dei fotogrammi **e una perdita di qualita' pagata solo
per attraversare il cavo**. Sulla stessa macchina i PNG si rinominano: nessuna
ricompressione, e il Mac non apre un fotogramma.

#### Scenario: ripresa nuova pronta da giudicare
- **GIVEN** un job di generazione completato
- **WHEN** si torna alla vista di scelta
- **THEN** la ripresa nuova è in coda, riproducibile
- **AND** porta con sé il prompt che l'ha generata

### Requirement: GEN-04 — La generazione video non tocca i progetti foto

Le rotte e i worker della generazione video SHALL essere attivi solo su progetti
`kind: "video"`. Un progetto foto SHALL continuare a funzionare senza modifiche.

#### Scenario: progetto foto invariato
- **GIVEN** il progetto Japan, 190 foto e 1647 versioni
- **WHEN** lo si apre dopo questo change
- **THEN** griglia, dettaglio e generazione funzionano come prima
- **AND** nessuna rotta video è raggiungibile in quel contesto
