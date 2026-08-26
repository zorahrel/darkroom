## ADDED Requirements

### Requirement: OAI-01 — Il backend a pagamento non si sceglie da solo

Il sistema SHALL usare `cdp` quando `WORKER_BACKEND` non è impostato, e SHALL
attivare il backend `openai` solo su richiesta esplicita.

Motivazione misurata: `openai` è l'unico backend che addebita a ogni
generazione (~$0.21 per una `high` 1024², misurato il 26/08). Un default
sbagliato non produce nessun sintomo visibile finché non arriva la fattura,
quindi il default va difeso da un test, non dalla memoria di chi legge il
codice.

#### Scenario: nessuna variabile d'ambiente
- **GIVEN** un processo senza `WORKER_BACKEND`
- **WHEN** la configurazione viene letta
- **THEN** il backend attivo è `cdp`
- **AND** nessuna chiamata a pagamento è possibile senza un'azione esplicita

#### Scenario: attivazione esplicita
- **GIVEN** `WORKER_BACKEND=openai`
- **WHEN** la configurazione viene letta
- **THEN** il backend attivo è `openai`

### Requirement: OAI-02 — Solo il backend cdp guida un browser

Il sistema SHALL considerare "guidato da browser" il solo backend `cdp`, e NON
SHALL avviare o sorvegliare Chrome per gli altri backend.

Motivazione misurata: il guard esistente escludeva per nome il solo `"codex"`,
quindi `codex-http` e `openai` cadevano nel ramo che lancia il browser e lo
riavvia quando non risponde — sorvegliando una finestra che quei backend non
usano.

#### Scenario: backend senza browser
- **GIVEN** `WORKER_BACKEND` è `codex`, `codex-http` oppure `openai`
- **WHEN** il runner lavora la coda
- **THEN** nessun controllo di vitalità del browser viene eseguito
- **AND** nessun processo Chrome viene avviato o riavviato

### Requirement: OAI-03 — La chiave non sta in un file in chiaro

Il sistema SHALL leggere la chiave OpenAI dal Keychain (servizio `openai`,
account `darkroom`), e `OPENAI_API_KEY` nell'ambiente SHALL avere la
precedenza per CI e test. La chiave NON SHALL comparire in nessun file
versionato né in `.env`.

Motivazione: `.env` del progetto è `-rw-r--r--`, leggibile da qualunque
processo dell'utente. La convenzione era già scritta in
`scripts/imagerouter_check.ts`.

#### Scenario: chiave assente
- **GIVEN** nessuna chiave nel Keychain né nell'ambiente
- **WHEN** un job viene lavorato col backend `openai`
- **THEN** il job fallisce con un messaggio che dice il comando esatto per
  registrarla
- **AND** nessuna chiamata di rete viene tentata

### Requirement: OAI-04 — Il costo si legge, non si stima

Il sistema SHALL calcolare il costo di una generazione dai token riportati
dall'API nel campo `usage`, e NON SHALL derivarlo da una tabella di
dimensioni.

Motivazione misurata: i docs OpenAI danno 4160 token per una `high` 1024²; il
batch del 26/08 ne ha consumati **7024**, il 69% in più. Una stima da tabella
avrebbe sottostimato ogni immagine. Un modello sconosciuto SHALL comunque
produrre un costo maggiore di zero, perché un costo nullo farebbe sembrare
gratuita una passata che si paga.

#### Scenario: costo di una generazione riuscita
- **GIVEN** una risposta con `usage.output_tokens = 7024` per `gpt-image-2`
- **WHEN** il costo viene calcolato
- **THEN** vale $0.2107 al prezzo sincrono
- **AND** la metà in modalità batch

### Requirement: OAI-05 — Un risultato "ok" deve corrispondere a un file valido

Il sistema SHALL considerare riuscita una generazione solo se il file esiste su
disco ed è non vuoto; una scrittura mancata o un file di zero byte SHALL
produrre un errore.

Motivazione: una versione rotta in galleria non si distingue da una buona
finché non la si apre, e un `status: "ok"` che lascia zero byte sposta il
problema a valle, dove costa di più. Un `edit` che restituisce byte identici
alla sorgente è un fallimento silenzioso e va trattato come tale in fase di
verifica.

#### Scenario: generazione riuscita
- **GIVEN** una chiamata che restituisce un'immagine
- **WHEN** il worker termina con `ok`
- **THEN** il file esiste, inizia con la firma PNG e supera il kilobyte
- **AND** `size_kb` riportato è maggiore di zero

#### Scenario: sorgente inesistente
- **GIVEN** un job il cui `input_path` non esiste
- **WHEN** il worker viene eseguito
- **THEN** il risultato è un errore
- **AND** nessun file parziale resta sul disco

### Requirement: OAI-06 — Il batch vive fuori dal job loop

Il sistema SHALL offrire la modalità batch come strumento separato, e NON
SHALL usarla dentro il runner sincrono della coda.

Motivazione misurata: il job loop scrive `done` appena il worker ritorna,
mentre un batch reale da 2 immagini `high` ha impiegato **708s** prima di
passare a `completed`. Dentro il loop, quell'attesa bloccherebbe il runner per
tutti gli altri job. Lo sconto del 50% si paga in attesa, e l'attesa ha senso
solo quando i prompt sono già decisi.

#### Scenario: raccolta parziale
- **GIVEN** un batch completato in cui una richiesta è fallita
- **WHEN** si raccolgono i risultati
- **THEN** le immagini riuscite vengono salvate comunque
- **AND** le fallite vengono elencate con il loro motivo
- **AND** il comando esce con codice diverso da zero

#### Scenario: raccolta anticipata
- **GIVEN** un batch ancora `in_progress`
- **WHEN** si tenta di raccoglierlo
- **THEN** il comando rifiuta indicando lo stato
- **AND** non scrive nessun file parziale
