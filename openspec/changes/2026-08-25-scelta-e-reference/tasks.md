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
- [ ] 1.1 `jobs.input_paths` (JSON array) + `versions.lineage` (JSON), NULL sullo storico
- [ ] 1.2 Preamboli come record con id citabile, i tre esistenti migrati
- [ ] 1.3 Scrittura del lineage nel worker, in un solo punto

## 2. Generazione multi-sorgente
- [ ] 2.1 `enqueueJob` accetta N sorgenti; `input_path` = prima voce
- [ ] 2.2 Il worker allega tutte le sorgenti e dichiara nel prompt che è la stessa persona
- [ ] 2.3 Limite di 6 allegati totali con errore esplicito

## 3. Vista ad albero
- [ ] 3.1 Route `/p/<id>/albero`, una colonna per sorgente
- [ ] 3.2 Rami raggruppati per configurazione, con riferimenti/ricetta/preambolo leggibili
- [ ] 3.3 Voto `tieni | forse | scarta` + nota, persistiti nel DB (non solo nel browser)
- [ ] 3.4 "Ripeti questa configurazione" su un'altra foto
- [ ] 3.5 Versioni senza lineage sotto "origine non registrata"

## 4. Reference
- [ ] 4.1 Aggiunta di una reference con ruolo `stile | identità`, copiata nel progetto
- [ ] 4.2 Estrazione del prompt via `codex-http`, con passaggio umano obbligatorio
- [ ] 4.3 La ricetta salvata cita la reference di provenienza
- [ ] 4.4 `archive_variants` esposto dall'interfaccia (già esiste da riga di comando)

## 5. Verifica
- [ ] 5.1 Test sui due casi del controllo allegati (morde / non morde a vuoto)
- [ ] 5.2 Test che una versione senza lineage non sparisca dall'albero
- [ ] 5.3 Passata completa sul progetto Profilo con le 3 foto come input unico
