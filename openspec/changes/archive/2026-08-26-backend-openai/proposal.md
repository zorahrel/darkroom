# Backend OpenAI — gpt-image-2 in batch, accanto al CDP

## Why

Darkroom oggi genera con tre backend, e tutti e tre passano da una sessione che
non controlliamo: `cdp` guida il browser loggato su ChatGPT, `codex` e
`codex-http` parlano alla CLI Codex. Funzionano e non costano, ma condividono
un limite strutturale: **la quota è quella di un account interattivo**, e una
passata da cinquanta pannelli la esaurisce.

Il limite è misurato, non ipotizzato. Il piano ChatGPT Plus dà ~50 generazioni
per finestra di 3 ore; una sessione di storyboard reale ne ha prodotte 162 in un
pomeriggio (vedi `2026-08-25-scelta-e-reference`). Sopra quella soglia il
browser inizia a rifiutare e il job loop accumula fallimenti che non sono bug.

C'è anche una pista già battuta e già chiusa: `scripts/imagerouter_check.ts`
punta a `openai/gpt-image-1.5:free` via aggregatore, con un commento che dice
la cosa giusta — "gratis nei cataloghi degli aggregatori regge spesso solo i
primi giorni". Verificato il 26/08: i tier gratuiti che servono davvero
`gpt-image-2` non esistono. Puter chiede login e poi fa pagare l'utente,
LMArena espone solo `gpt-image-1` in Direct, OpenRouter non sconta nulla.

## What Changes

Un quarto valore di `WORKER_BACKEND`: `openai`. **Affianca, non sostituisce.**
Il default resta `cdp`, che è gratis; il backend OpenAI si sceglie quando serve
volume e la qualità deve essere alta.

| Aspetto | Scelta | Perché |
|---|---|---|
| Modello | `gpt-image-2` | l'unico che regge il testo dentro l'immagine |
| Qualità | `high` | è il caso d'uso: asset finali, non bozze |
| Esecuzione | **Batch API** | metà prezzo sullo stesso modello |
| Chiave | Keychain `openai/darkroom` | convenzione già scritta in `imagerouter_check.ts` |

### Il nodo vero: batch è asincrono, il job loop è sincrono

`runActiveWorker` ha firma `Promise<WorkerResult>` e il loop scrive `done` o
`failed` appena ritorna. La Batch API invece accetta il lavoro e lo restituisce
entro una finestra di 24h. Le due cose non si incastrano da sole.

Misurato il 26/08 su un batch reale da 2 immagini `high`: `in_progress` dopo
10s, ancora `in_progress` a 143s. Quindi **non** è una latenza da nascondere
dietro un `await`: un job che aspetta il batch tiene occupato il runner per
minuti o ore.

La proposta è di **non** forzare batch dentro il loop sincrono:

- `WORKER_BACKEND=openai` usa l'endpoint **sincrono** (`/v1/images/generations`)
  quando il job arriva dalla UI, dove qualcuno sta guardando lo schermo.
- Il batch è una **rotta separata**: si accoda una lista di prompt, si chiude il
  terminale, si raccoglie dopo. È il caso "cinquanta pannelli", non "questa foto".

Questo tiene onesto il costo: batch dimezza solo se accetti l'attesa, e
l'attesa ha senso solo quando non stai iterando.

## Impact

- `server/worker-openai.ts` (nuovo): worker sincrono, stessa firma degli altri
- `server/config.ts`: `OPENAI_KEY` dal Keychain, `OPENAI_IMAGE_QUALITY`
- `server/jobs.ts`: un ramo in più in `runActiveWorker`
- `scripts/openai_batch.ts` (nuovo): accoda/raccoglie, fuori dal job loop
- `.env.example`: documenta `WORKER_BACKEND=openai`
- **Costo**: da zero a ~$0.12/immagine sincrona, ~$0.06 in batch. Va tracciato
  per job, altrimenti non si sa quanto costa un progetto.
