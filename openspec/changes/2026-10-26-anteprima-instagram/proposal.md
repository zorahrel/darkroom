# Anteprima Instagram

## Perché

Per giudicare la foto profilo e i post del Giappone serviva vederli dove finiranno: il profilo vero di @zorahrel, su iPhone, con i post nuovi in cima ai vecchi. Un mock con dati inventati non bastava ad Attilio, e un'immagine ferma non si scorre. Questa vista è anche il posto dove arriverà la pubblicazione.

## Cosa cambia

- `scripts/ig_snapshot.mjs`: legge la pagina pubblica di un account con WebKit headless (contesto desktop: da iPhone Instagram mostra solo «Apri app»; l'endpoint JSON risponde 401 da questo Mac) e salva nome, bio, link, conteggi, evidenze e i 12 post visibili in `~/Darkroom/instagram/<utente>/`.
- `server/instagram.ts` + `server/routes/instagram.ts`: `GET/PUT /api/instagram` (account e foto profilo di prova sono impostazioni del progetto), `POST /api/instagram/refresh` (lancia lo script), `/instagram-media/:utente/:file`. I post in programma sono le collezioni del progetto, dal più recente, con la copertina graduata della preferita.
- `client/src/pages/Instagram.tsx`, linguetta «Instagram» e rotta `/p/:pid/instagram`: un iPhone 393×852 che scorre, evidenze che scorrono di lato, tema scuro o chiaro, post in programma accendibili, foto profilo da una versione di qualunque progetto.

## Fuori

Pubblicare davvero, didascalie e ordine dei post dentro la vista, login a Instagram, i post oltre i 12 che Instagram mostra a un visitatore.

## Non ancora specificato

La pubblicazione: con quale strada (API Graph di un account professionale o browser), e se la didascalia e l'ordine si decidono qui o restano nelle collezioni.

## Barra

Vedi `specs/acceptance.md`.
