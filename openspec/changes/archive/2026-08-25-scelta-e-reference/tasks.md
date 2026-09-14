# Tasks — scelta e reference

Convenzione: `[ ]` da fare, `[x]` fatto+verificato.

**Stato: in attesa di approvazione.** Nessun codice prima dell'approvazione.

## Barra (si scrive ora, si esegue sempre uguale)

- `bunx tsc --noEmit` esce zero
- `bun test` esce zero, e i test esistenti restano verdi
- Japan aperto in griglia: 190 foto, zero immagini rotte (misurato via CDP, non a occhio)
- Profilo aperto in albero: 3 sorgenti, ogni variante mostra la sua configurazione
- Una generazione a 3 sorgenti produce una versione collegata a tutte e tre
- Una generazione che restituisce un allegato **fallisce** (il controllo morde: verificato
  con un file uguale a se stesso → 1.00)
- Un ritaglio quadrato legittimo **non** fallisce (verificato: 0.03 con la sorgente)

## 1. Dati e lineage
- [x] 1.1 `jobs.input_paths` (JSON array) + `versions.lineage` (JSON), NULL sullo storico
- [~] 1.2 Preamboli come record — FUORI: un preambolo e' un'ISTRUZIONE, non un ingresso,
      e modellarlo e' un secondo cambiamento (deciso in `version-inputs`, §2 del design).
      Resta testo dentro `lineage`, che e' dove l'albero lo legge e lo mostra.
- [x] 1.3 Scrittura del lineage nel worker, in un solo punto

## 2. Generazione multi-sorgente
- [x] 2.1 `enqueueJob` accetta N sorgenti; `input_path` = prima voce
- [x] 2.2 Il worker allega tutte le sorgenti e dichiara nel prompt che è la stessa persona
- [x] 2.3 Limite di 6 allegati totali con errore esplicito

## 3. Vista ad albero
- [x] 3.1 Route `/p/<id>/albero`, una colonna per sorgente
- [x] 3.2 Rami raggruppati per configurazione, con riferimenti/ricetta/preambolo leggibili
- [x] 3.3 Voto `tieni | forse | scarta` + nota, persistiti nel DB (non solo nel browser)
- [x] 3.4 "Ripeti questa configurazione" su un'altra foto
- [x] 3.5 Versioni senza lineage sotto "origine non registrata"

## 4. Reference
- [x] 4.1 Aggiunta di una reference con ruolo `stile | identità`, copiata nel progetto
- [x] 4.2 Estrazione del prompt via `codex-http`, con passaggio umano obbligatorio
- [x] 4.3 La ricetta salvata cita la reference di provenienza
- [x] 4.4 `archive_variants` esposto dall'interfaccia (già esiste da riga di comando)

## 5. Verifica
- [x] 5.1 Test sui due casi del controllo allegati (morde / non morde a vuoto)
- [x] 5.2 Test che una versione senza lineage non sparisca dall'albero
- [x] 5.3 Passata su Profilo: 7 radici / 125 varianti, una radice con 4 scatti nell'insieme,
      96 strisce di ingressi (66 con riferimenti, 30 che dichiarano «nessuno»), 34 gruppi
      marcati «origine dedotta», zero anteprime rotte. Video: ~/Desktop/darkroom-albero.webm
