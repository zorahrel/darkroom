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

## 6. Prova end-to-end (aggiunta dopo la prima passata)

La prima tornata verificava lo *status* del worker. Ma `status: "ok"` non è ciò
che l'utente vede: quello che vede è un file in galleria, e un worker può
rispondere ok lasciando zero byte o l'originale intatto.

- [x] 6.1 `tests/openaiE2E.test.ts` — chiamate reali in `low` (~$0.006/immagine)
- [x] 6.2 Si controllano i **byte**: firma PNG (`89 50 4E 47…`), size > 1 KB
- [x] 6.3 L'edit deve produrre un file **diverso** dalla sorgente (un edit che
      restituisce l'input è un fallimento che passerebbe inosservato)
- [x] 6.4 Un errore non lascia file mezzo scritti sul disco
- [x] 6.5 Opt-in dietro `OPENAI_E2E=1`: accesi di default portavano `bun test`
      da 15s a **342s** e facevano pagare ogni run. Verificato nei due versi:
      senza la variabile 2 skip in 230ms, con la variabile 3 pass in 36s.

## 7. Spec formale (mancava)

La prima passata aveva `proposal.md` e `tasks.md` ma **non** `specs/`, che ogni
altro change del progetto ha. Senza, i requisiti restavano dentro un discorso
invece che in forma verificabile.

- [x] 7.1 `specs/generation/spec.md` — 6 requirement OAI-01..06 in forma SHALL
- [x] 7.2 Ogni requirement mappato a un test esistente; i due scoperti (OAI-03
      chiave assente, OAI-05 file valido) hanno ora un test proprio
- [x] 7.3 Il test su OAI-03 verifica l'ordine **dentro ciascun entry point**:
      il primo tentativo guardava la posizione nel file e falliva, perché le
      helper col `fetch` sono dichiarate sopra. Falliva a ragione.
- [x] 7.4 Un test blocca la regressione peggiore: una chiave in chiaro in
      `.env.example` (regex `sk-...`)

## 8. Il routing provato sul traffico, non sul sorgente

I controlli di 7.x leggono il file: dicono che il codice *sembra* giusto. Manca
la prova che una richiesta parta davvero verso OpenAI quando il backend e'
`openai`.

- [x] 8.1 Test che intercetta `fetch` e verifica la URL
      (`https://api.openai.com/v1/images/generations`)
- [x] 8.2 Intercetta **senza inoltrare**: stessa risposta su una macchina senza
      rete, e nessuna richiesta spesa. Verificato che offline il worker
      restituisce un errore pulito e non lascia file (`ENOTFOUND` simulato).
- [x] 8.3 Provato che morde: endpoint cambiato in `api.SBAGLIATO.com` -> 1 fail;
      ripristinato -> 10 pass.

## 9. Il server acceso, e il JSONL che parte davvero

Mancavano le due prove piu' vicine all'uso reale: che Darkroom **si avvii** col
backend nuovo, e che `submit` chieda davvero `high` (era la direttiva).

- [x] 9.1 Boot con `WORKER_BACKEND=openai` su root e porta di scarto: il server
      parte, `/api/studio/projects` riporta `backend: openai` e
      `browser_alive: null` — non tocca Chrome
- [x] 9.2 Controprova con `cdp`: `browser_alive: true`, il browser lo controlla
      eccome. Il predicato di OAI-02 e' provato sul server vivo, non sul sorgente.
- [x] 9.3 Il JSONL del batch contiene `"model":"gpt-image-2"` e
      `"quality":"high"` su ogni riga; commenti e righe vuote non diventano
      immagini pagate
- [x] 9.4 Morde: `quality` forzata a `"low"` -> 1 fail; ripristinata -> 11 pass
- [x] 9.5 Il runner lock ha retto: l'istanza reale su :3737 non e' stata
      disturbata (il secondo processo ha rifiutato di aprire una seconda coda)

Barra finale: `tsc` 0 · **379 test, 377 pass + 2 skip opt-in, 0 fail, 9.0s**.
