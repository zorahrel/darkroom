# Design — backend OpenAI

Le decisioni prese qui e il perché, comprese quelle che sembrano ovvie ma sono
il risultato di una misura contraria all'aspettativa.

## Perché il worker è sincrono, e il batch no

L'idea di partenza era usare la Batch API dentro il job loop: costa metà, e il
loop è già asincrono. È sbagliata, e la misura lo dice.

`runActiveWorker` ha firma `Promise<WorkerResult>`, e il loop scrive `done` o
`failed` appena ritorna. Un batch reale da 2 immagini `high` è passato a
`completed` dopo **708s**, con `in_progress` costante per i primi 5 minuti. Con
quella firma, un job in batch terrebbe il runner occupato per tutta la durata,
bloccando gli altri.

Le alternative erano tre:

1. **Batch dentro il loop, con polling.** Il runner resta appeso: un job da
   dieci minuti blocca una coda che oggi macina un job ogni ~3 minuti.
2. **Stato `waiting_batch` in DB + ripresa.** Corretto, ma è un pezzo di
   macchina nuova (colonna, migrazione, riconciliazione dei batch orfani dopo
   un riavvio) per uno sconto che si applica solo quando i prompt sono già
   decisi.
3. **Due strade separate.** Il worker sincrono per la UI, dove qualcuno sta
   guardando lo schermo; uno script per il batch, dove l'attesa è dichiarata.

Scelta la 3. Il criterio non è il prezzo ma **chi sta aspettando**: se stai
iterando su un'idea, 708s non sono uno sconto, sono un blocco. Se hai
cinquanta prompt già scritti, non stai aspettando nessuno.

La 2 resta la strada giusta se un giorno il batch dovrà partire dalla UI. Non
è stata fatta perché oggi nessuno l'ha chiesta, e costa una migrazione.

## Perché il costo si legge invece di stimarlo

La tabella nei docs OpenAI dà 4160 token per una `high` 1024². Il batch del
26/08 ne ha consumati **7024**, il 69% in più; una `low` ne ha usati 196 dove la
tabella ne dava 272.

Non è un errore dei docs: `gpt-image-2` usa un calcolatore, non una tabella
fissa, e il numero dipende dal contenuto. Ma significa che qualsiasi stima
basata sulla dimensione richiesta è sbagliata in modo non prevedibile — e
sbagliata **al ribasso**, che è la direzione peggiore per un costo.

Quindi `costUsd()` prende i token da `usage` nella risposta. Il prezzo per
milione resta una costante nel codice: cambia raramente e non è deducibile
dalla risposta.

Un modello sconosciuto ricade su $30/M invece di 0. Tornare zero avrebbe fatto
sembrare gratuita una passata che si paga, che è esattamente il tipo di errore
che non si nota finché non arriva la fattura.

## Perché la chiave sta nel Keychain

`.env` di questo progetto è `-rw-r--r--`: leggibile da qualunque processo
dell'utente. La convenzione era già scritta in `scripts/imagerouter_check.ts`
("La chiave si legge dal Keychain, mai da un file in chiaro") e questo change
la segue invece di aprirne una seconda.

`OPENAI_API_KEY` dall'ambiente ha comunque la precedenza: serve per CI e per i
test, dove un Keychain non c'è.

La lettura è **memoizzata**. `security` costa ~50ms per invocazione, e un job
loop la chiederebbe a ogni generazione; `null` distingue "cercata e non
trovata" da "non ancora cercata", così un'assenza non viene ritentata a ogni
job.

## Il guard sul browser era rotto prima di questo change

Il controllo di vitalità di Chrome escludeva per nome il solo `"codex"`:

```ts
if (WORKER_BACKEND !== "codex" && !(await checkChatgptBrowserAlive()))
```

Con `codex-http` e `openai` la condizione è vera, quindi Darkroom lanciava e
riavviava Chrome per sorvegliare una finestra che quei backend non usano. Il
bug è preesistente — `codex-http` lo aveva già — ma sarebbe diventato visibile
qui, dove il senso del backend è proprio non passare dal browser.

Sostituito con un predicato dichiarativo, `BACKEND_USES_BROWSER`, che dice
quale backend guida un browser invece di elencare quali non lo fanno. Un
backend nuovo non deve ricordarsi di aggiungersi a una lista di esclusioni.

## Il testo dentro l'immagine è il criterio, non la risoluzione

La ragione per cui questo backend usa `gpt-image-2` in `high` non è la
risoluzione: è che i modelli piccoli sbagliano le lettere. Misurato sullo
stesso prompt, un'insegna con scritto "ARMONIA":

| modello | resa |
|---|---|
| Sana (Pollinations, gratis) | "MONA RD 4" |
| `gpt-image-2` high | "ARMONIA COFFEE ROASTERS" |

Per una bozza senza testo la differenza non giustifica $0.21. Per un'insegna,
una copertina o qualunque cosa con parole dentro, è l'unica opzione che
funziona.
