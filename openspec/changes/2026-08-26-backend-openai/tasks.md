# Tasks — backend OpenAI

Convenzione: `[ ]` da fare, `[x]` fatto+verificato.

## Barra

- `bunx tsc --noEmit` esce zero ✓
- `bun test` esce zero e i 365 test esistenti restano verdi ✓ (372 ora)
- Senza `WORKER_BACKEND` il default resta `cdp`: il backend a pagamento non si
  sceglie da solo ✓
- Una `generate` reale produce un PNG con testo **leggibile** (il caso in cui i
  modelli piccoli falliscono) ✓
- Un `edit` reale modifica la sorgente conservando il testo ✓
- Il costo si legge dai token dell'API, non da una tabella ✓

## 1. Chiave e configurazione
- [x] 1.1 `openaiKey()` legge dal Keychain (`openai/darkroom`), `OPENAI_API_KEY`
      dell'ambiente ha la precedenza; letta una volta sola (`security` costa ~50ms)
- [x] 1.2 `OPENAI_IMAGE_MODEL` / `QUALITY` / `SIZE` con default `gpt-image-2` / `high` / `1024x1024`
- [x] 1.3 `.env.example` documenta il backend **senza** contenere la chiave

## 2. Worker sincrono
- [x] 2.1 `runWorkerOpenAiGenerate` (text-to-image, `/v1/images/generations`)
- [x] 2.2 `runWorkerOpenAi` (edit, `/v1/images/edits`, allega sorgente + reference)
- [x] 2.3 MIME esplicito sui Blob — senza, l'endpoint edits rifiuta con
      `unsupported mimetype ('application/octet-stream')` (trovato dal test, non a occhio)
- [x] 2.4 `costUsd()` dai token riportati in `usage`

## 3. Wiring
- [x] 3.1 `runActiveWorker` conosce `openai`
- [x] 3.2 `runActiveGenerate`: il text-to-image passava **sempre** dal browser
      anche con un altro backend scelto, quindi la quota che si voleva evitare
      rientrava dalla finestra
- [x] 3.3 `BACKEND_USES_BROWSER`: il guard escludeva per nome il solo `"codex"`,
      quindi `codex-http` e `openai` finivano nel ramo che lancia Chrome

## 4. Batch (rotta separata)
- [x] 4.1 `scripts/openai_batch.ts` con `submit` / `status` / `fetch`
- [x] 4.2 Una riga fallita non fa perdere le altre; exit non-zero se ce ne sono
- [x] 4.3 Riporta costo batch e confronto col sincrono

## 5. Test
- [x] 5.1 `tests/workerOpenai.test.ts` — 7 test
- [x] 5.2 Verificato che mordano: reintrodotto il bug di 3.3 → 1 fail; ripristinato → 7 pass

## Misure (26/08/2026)

| | valore | nota |
|---|---|---|
| generate `high` 1024² | 172s, 1711 KB | testo: "ARMONIA COFFEE ROASTERS" ✓ |
| edit `high` | 154s, 1541 KB | notte+neon, testo conservato ✓ |
| batch 2× `high` | **708s** | `completed`, 2/2 |
| token `high` | **7024** | i docs ne davano 4160: **+69%** |
| costo `high` | $0.2107 sync, **$0.1054 batch** | |
| token `low` | 196 | i docs ne davano 272 |

Il numero dei token è il motivo per cui `costUsd` legge `usage` invece di
stimare: una tabella avrebbe sottostimato del 69% ogni immagine.

## Non fatto (deliberatamente)

- **Costo per job in DB.** Serve una colonna e una migrazione; il worker già
  espone `costUsd`, ma tracciarlo per progetto è un lavoro suo, da fare quando
  si sarà deciso *dove* mostrarlo (griglia? lineage? un totale per progetto?).
- **Batch dentro il job loop.** 708s per due immagini: il loop è sincrono e
  resterebbe bloccato. Il batch è una rotta separata, e va bene così.
