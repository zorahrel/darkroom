## Why

Il progetto `Profilo` ha reso visibile un limite che su Japan non si notava: **la griglia
mostra le versioni, non da dove vengono**. Con 3 foto, 5 ricette e 4 combinazioni di
riferimenti provate in un pomeriggio, guardando una variante non si sa più con quale input
è nata — e quindi non si sa cosa ripetere.

Il costo è misurato, non ipotizzato. In questa sessione sono state prodotte 162 varianti in
sei configurazioni diverse; 97 sono state archiviate perché nate da riferimenti sbagliati, e
per capirlo è servito interrogare il database a mano, perché in griglia erano
indistinguibili. Tre difetti hanno attraversato lo stesso buco:

- una passata intera fatta con un preambolo che diceva al modello di **ignorare l'aspetto**
  delle reference, scoperta solo perché l'utente ha detto "non escono le reference giuste";
- due passate con gli **stessi file** ma istruzioni diverse, indistinguibili in griglia;
- 17 varianti con anteprime rotte, invisibili da riga di comando (gli endpoint rispondevano
  200) e visibili solo aprendo la pagina.

Nessuno dei tre era un bug di generazione: erano tutti **buchi di leggibilità**.

In più, due cose che il flusso attuale non sa fare e che servono adesso:

1. **Più foto sorgente in una sola generazione.** Oggi un job ha una sorgente e N
   riferimenti. Ma tre ritratti della stessa persona come *input contemporaneo* sono un caso
   diverso dal riferimento: si vuole che il modello guardi tutti e tre e produca una
   variante nuova, non che ne modifichi uno usando gli altri come contorno.
2. **Una reference da cui ricavare il prompt.** Il prompt di una ricetta oggi è scritto a
   mano. Con un'immagine di riferimento davanti, descriverla a parole è lavoro che il modello
   fa meglio di noi — ed è anche l'unico modo di rendere ripetibile un look che arriva come
   immagine e basta.

## What Changes

Tre capability nuove, indipendenti fra loro ma che chiudono lo stesso ciclo
(**genera → capisci da cosa → scegli → ripeti la ricetta buona**):

| # | Capability | Cosa aggiunge |
|---|---|---|
| 1 | `lineage` | Vista ad albero: sorgente → varianti, con la configurazione che le ha prodotte, pensata per **scegliere** invece che per sfogliare |
| 2 | `generation` (esteso) | Un job può avere **più foto sorgente**; il set di input viene registrato per intero |
| 3 | `reference` | Si allega un'immagine e si **estrae il prompt** che la descrive, riutilizzabile come ricetta |

## Impact

- **Schema**: `jobs.input_paths` (JSON array) accanto a `input_path`; `versions.lineage`
  (JSON: sorgenti, riferimenti, ricetta, preambolo). Nessuna migrazione distruttiva: i campi
  esistenti restano, i nuovi sono NULL sullo storico.
- **UI**: una terza vista accanto a Griglia e Dettaglio (`/p/<id>/albero`).
- **Progetti esistenti**: Japan (190 foto, 1647 versioni) e Profilo devono continuare a
  funzionare senza toccare un file. Lo storico senza `lineage` si mostra come "origine non
  registrata", non si nasconde e non si inventa.

## Non-goals

- Nessuna modifica al motore di generazione (`codex-http` resta com'è).
- Nessun editor di prompt visuale: il prompt estratto è testo, si modifica come testo.
- Nessun ri-tracciamento retroattivo dello storico: ciò che non è stato registrato resta
  non registrato. Inventarlo sarebbe peggio del vuoto.
