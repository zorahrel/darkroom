# Tasks

## 0. Prerequisito
- [x] `./anteprime.sh` sul progetto video — 43 piani su 272 hanno la clip leggera; lo
      script salta quelli già fatti

## 1. Lato Python (i due file che mancano)
- [x] `pianifica.py` scrive `atti.json` (confini + nome) quando genera il piano
- [x] `pianifica.py --dump-esclusi` → `esclusi.json` (piano → motivazione da `BANDITI` + `scelte`)
- [x] `pianifica.py` legge `pin` e `durata` da `scelte.json`
- [x] Quando una forzatura sospende una garanzia, `pianifica.py` lo scrive nel piano
      (`sospese: [{taglio, garanzia}]`) invece di tacere

## 2. `server/video.ts` — allineare alla catena di oggi
- [x] `origine()` lato server, e raggruppamento delle riprese per origine
- [x] leggere `atti.json`, esporre l'atto su ogni piano e su ogni taglio
- [x] leggere `esclusi.json`, esporre la motivazione sui piani non usati
- [x] togliere `Cut.fermo` (`subdiv <= 0` non succede più col movimento pieno)
- [x] `clipPath`/`posterPath`: riprese oltre `a|b|c`
- [x] scrivere `pin` e `durata` in `scelte.json`

## 3. `/video/scelta` — la modalità di giudizio
- [x] `client/src/pages/VideoScelta.tsx`: una scena per volta, 9:16, loop
- [x] tastiera: `←` scarta · `→` tieni · `↑` annota · `spazio` rivedi
- [x] pannello dati: atto, secondi in scena, minuto, prompt
- [x] filtri: per atto · solo in montaggio · solo scartate · contatore
- [x] scene con più spezzoni della stessa origine mostrate insieme
- [x] rotta in `client/src/App.tsx`

## 4. La barra in pagina
- [x] `GET /api/video/barra` esegue `check.py` e restituisce le condizioni analizzate
- [x] intestazione di `/video` con le sei righe e i valori misurati

## 5. `/video` — l'editor
- [x] bande degli atti sopra la timeline, curva di durezza del brano sotto
- [x] clic su un taglio → pannello: piano, durezza suono, durezza piano, atto, origine
- [x] forzature: inchioda · durata · escludi → `scelte.json`
- [x] `POST /api/video/ricostruisci` lancia `master.sh`, log in streaming, un solo giro alla volta
- [x] a fine ricostruzione la barra si aggiorna da sola

## 6. Generazione sulla 3090
- [x] `server/comfy.ts`: il grafo di `gen.py` portato invariato
- [x] `provider: "comfy"` nella tabella `jobs`; worker che posta, attende, riporta
- [x] parametri visibili (risoluzione, fotogrammi, passi, tasselli) con i default che stanno in memoria
- [x] fallimento per "nessun fotogramma dopo N", non per tempo fisso
- [x] a fine job i fotogrammi restano sul PC: `raccogli.sh` li porta in
      `src/<piano>/`, interpola in `srci/` e fa la clip — attraversa il cavo
      solo l'anteprima da 1 MB. Il passaggio h264 a crf 10 di `pullvid.sh`
      sparisce: era una perdita pagata per il collegamento, non per il montaggio
- [x] pannello di rigenerazione dalla scheda della scena, con la nota accanto al prompt

## 7. Registrazione e recinzione
- [x] voce in `~/Darkroom/projects.json` per `~/Music/Music/Songs/progetto_video`, `kind: "video"`
- [x] le rotte `/api/video/*` rispondono solo su progetti `kind: "video"`

## 8. La barra del change
- [x] `bun run typecheck && bun test` esce 0
- [ ] le sei condizioni in pagina coincidono con `python3 check.py` sullo stesso build
- [ ] boccio una scena → ricostruisco → quel piano non è in `plan.json`
- [ ] rigenero dalla UI → PNG in `src/<piano>/` → la clip appare in coda
- [ ] Japan e Profilo si aprono e funzionano come prima
- [ ] `.webm` del giro completo come prova
