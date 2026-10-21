## Da decidere

1. **I ritocchi si agganciano alla versione principale con due colonne nuove in `versions` (`parent_version_id`, `retouch_number`); i numeri globali e i file `vNNN.png` restano come sono** (consigliato): v368 diventa «v364 · r1», il file resta `v368.png`, nessun link e nessuna miniatura si rompe. Alternativa: rinumerare tutto (`v364.1`), che costringe a rinominare file e a riscrivere `?v=` ovunque.
2. **Nella striscia in basso compaiono solo le principali; i ritocchi stanno in una seconda riga sotto la selezionata (r1, r2, r3), con «originale» per tornare alla principale** (consigliato): la pellicola resta quella delle generazioni, e il ritocco si legge come figlio. Alternativa: tutto in fila, con il badge «ritocco» di oggi.
3. **Un ritocco di un ritocco si appiattisce sulla principale: sempre r1, r2, r3 della stessa generazione, mai r1.1** (consigliato): «al massimo un versionamento di ritocchi», come hai detto. Alternativa: albero a più livelli.
4. **Il preferito può essere un ritocco** (consigliato): è il caso di v368, che oggi è una LUT su v364. Alternativa: il preferito è sempre la principale e il ritocco si «promuove» a parte.
5. **Il riempimento dei dati vecchi tocca solo le versioni `local` con una `partenza` che esiste** (consigliato): sono 10 in Profilo e 9 in Kaumat, tutte ricostruibili dalla lineage. Le 52 generazioni di Profilo nate da un'altra versione come foto di partenza restano principali: sono rigenerazioni, non ritocchi. Alternativa: includere anche quelle, ma si metterebbero sotto un padre che non le ha prodotte.

ok / ok ma 2 no

## Why

Oggi un ritocco (la LUT) è una versione come le altre: v368 sta in fila dopo v367, a quattro posti dalla v364 da cui nasce. Per capire da dove viene bisogna aprire la miniatura «partenza», e la striscia si riempie di versioni che sono la stessa foto con un colore diverso. Il ritocco dovrebbe essere tracciato sotto la principale.

## What Changes

- `server/db.ts`: migrazione `ALTER TABLE versions ADD COLUMN parent_version_id`, `retouch_number`; riempimento per le versioni `local` con `lineage.partenza` valida.
- `scripts/versione_da_file.ts` e il passo LUT del server: scrivono `parent_version_id` (la principale, anche se la partenza è un ritocco) e `retouch_number` successivo.
- `GET /api/photos/:id`: ogni versione porta `parent_version_id` e `retouch_number`.
- `VersionStrip.tsx` e `Detail.tsx`: striscia delle sole principali, seconda riga dei ritocchi della selezionata, `?v=` continua a puntare al numero globale.
- Test: migrazione su un DB con ritocchi, un ritocco di ritocco, preferito su un ritocco.

## Fuori

Niente rinumerazione di file, niente albero a più livelli, niente cambi alla pagina Albero. Le generazioni non cambiano.
