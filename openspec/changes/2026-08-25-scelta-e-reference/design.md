# Design — scelta e reference

## La decisione che regge tutto: sorgente ≠ riferimento

Oggi un job ha `input_path` (una sorgente) e `ref_paths` (N riferimenti), e il codice tratta
i riferimenti come "allegati in più". Questa sessione ha mostrato che i due ruoli non sono
sfumature dello stesso concetto:

| | Sorgente | Riferimento |
|---|---|---|
| Cos'è | materiale da cui esce il risultato | bersaglio a cui assomigliare |
| Il volto | **è** quello del risultato | non va copiato (se `stile`) |
| Quante | 1..N, tutte insieme | 0..N |
| Se cambia | cambia il soggetto | cambia il look |

Da qui: `jobs.input_paths` (array) accanto a `input_path` (che resta, e resta autorevole per
i job a sorgente singola), e `references` come entità di progetto con un **ruolo**, non come
lista di percorsi.

## Perché una vista nuova e non una griglia migliore

La griglia risponde a "quali foto ho". La domanda vera qui è "quale variante tengo, e da
cosa è nata" — che è una **relazione**, non un elenco. Provato sulla pelle: con 162 varianti
in sei configurazioni, la griglia non permetteva di rispondere senza query SQL.

Forma scelta: **una colonna per sorgente**, i rami raggruppati per configurazione, e la
configurazione scritta accanto al gruppo (riferimenti, ricetta, preambolo). Il voto e la nota
stanno sul ramo, non in un pannello a parte: si giudica guardando, non ricordando.

Alternative scartate:
- *Filtro sulla griglia*: nasconde ma non mette in relazione. Già provato nel provino HTML —
  funziona per confrontare due passate, non per scegliere dentro una.
- *Un albero unico per tutto il progetto*: con tre radici sta in piedi, con 190 (Japan) no.
  La vista è per-foto, con navigazione fra le foto.

## Il preambolo è un dato, non una stringa nel codice

Tre preamboli esistono già (`identità`, `stile`, `misto`) e sono nati uno alla volta, ognuno
dopo un errore. Devono diventare record con un id citabile, perché `lineage` deve poterli
nominare: senza, due passate identiche nei file e diverse nelle istruzioni restano
indistinguibili — che è esattamente il bug che ha bruciato 46 varianti.

## Estrazione del prompt: dove gira

Il modello che descrive l'immagine è lo stesso canale già usato per generare
(`codex-http`), con un prompt di sola lettura e nessun tool immagine. Non serve un motore
nuovo. Il testo estratto è una **proposta**: si salva come ricetta solo dopo modifica umana,
perché una descrizione plausibile ma sbagliata è peggio di nessuna descrizione — e su
questo materiale il rischio è concreto (moondream, il 25/08, ha dato risposte opposte sullo
stesso file a minuti di distanza).

## Cosa NON cambia

- Il motore `codex-http`, la coda, il locking.
- La griglia e la vista dettaglio.
- Japan: 190 foto e 1647 versioni non vengono toccate, e le loro versioni senza `lineage`
  compaiono come "origine non registrata".

## Rischi

| Rischio | Mitigazione |
|---|---|
| `input_paths` divergono da `input_path` | `input_path` resta la prima voce dell'array; un solo punto di scrittura |
| L'albero diventa illeggibile con 20+ varianti | raggruppamento per configurazione + collasso dei gruppi scartati |
| L'estrazione del prompt produce testo generico | passaggio umano obbligatorio prima di diventare ricetta |
| Il payload con N sorgenti + M riferimenti sfora | limite dichiarato di 6 allegati totali, con errore esplicito |
