# Barra

1. `bun test tests/instagram.test.ts` esce 0: post in programma dal più recente con copertina dalla preferita graduata, account non valido rifiutato, profilo con gli indirizzi delle sue immagini, avatar su progetto inesistente rifiutato senza cambiare la scelta.
2. `node scripts/ig_preview_check.mjs darkroom <cartella>` esce 0 a backend acceso e client costruito: lo schermo scorre fino in fondo, la barra in basso resta attaccata al fondo, le evidenze scorrono di lato. Il video `.webm` nella cartella è la prova del comportamento.
3. `node scripts/ig_snapshot.mjs zorahrel <cartella>` scrive `profile.json` con nome, bio, conteggi, evidenze e post, e le loro immagini.
4. Ciò che era verde resta verde: `bun run typecheck` senza errori nei file toccati.
