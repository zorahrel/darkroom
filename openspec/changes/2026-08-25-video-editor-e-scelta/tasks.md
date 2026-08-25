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
- [x] le sei condizioni in pagina coincidono con `python3 check.py` sullo stesso build
      (verde in pagina, `esito: verde`, stessi numeri del terminale)
- [x] boccio una scena → il piano si rifà senza: `d05` bocciato da Darkroom sparisce da
      `plan.json`, rimpiazzato da `f_alto1`, 64 tagli distinti; ripristinato, il piano
      torna identico
- [x] rigenerato dalla UI: prompt → 3090 → 61 PNG in `src/w_planata` sul PC → 119
      interpolati → anteprima ritirata sul Mac → la ripresa e' in coda. Il giro non
      fa piu' passare i fotogrammi dal Mac
- [x] Japan (190 foto) e Profilo (3) rispondono 200; le rotte video su un progetto foto
      restano 404 con il motivo scritto
- [x] `giro.webm` accanto a questo file: editor, clic sulla striscia, passo a fotogramma,
      taglio prima/dopo, trascinamento sulla timeline, e la scelta col pannello di
      rigenerazione

## 9. L'editor che si guarda davvero (25/08, dopo la prima passata)
- [x] `serveFile` risponde `206` sui `Range` e col tipo `video/mp4` — senza, il video non
      era cercabile e player, striscia e timeline erano inerti
- [x] 7 test sui pezzi di file: mezzo, coda, suffisso, oltre la fine, `416`
- [x] `barra()` non blocca piu' il server: era `spawnSync` dentro un IIFE asincrono
      (`/api/video/shots` da 45 ms a oltre 60 s mentre misurava), ora e' `Bun.spawn` sul PC
- [x] trasporto: play, passo a fotogramma, taglio prima/dopo, velocita', tastiera
- [x] striscia dei fotogrammi sotto la timeline, un poster per taglio
- [x] testina che segue il video; trascinare sulla timeline cerca
- [x] primo fotogramma visibile invece del rettangolo nero
- [x] la libreria dei 272 piani si richiude: la pagina era alta 28.511 px, ora 1.000
- [x] scelta: la clip prende l'altezza dello schermo, coda delle prossime dodici, avanzamento
- [x] `giro.webm` accanto a questo file: editor, clic sulla striscia, passo a fotogramma,
      taglio prima/dopo, trascinamento sulla timeline, e la scelta col pannello di
      rigenerazione

## 10. Da editor a editor (25/08, terza passata)
- [x] la timeline sta **sotto, a tutta larghezza**: schiacciata in una colonna non si legge
- [x] ogni corsia ha il suo nome in una colonna che non scorre — tempo · atti · suono ·
      tagli · quadri — e una legenda dice cosa vuol dire ogni colore
- [x] forma d'onda del brano con i confini di battuta (`/api/video/onda`, 2.400 picchi
      calcolati una volta e tenuti in `onda.json`)
- [x] zoom da tutto-in-vista a 128x (misurato 846 px → 13.536 px); a 16x compaiono i nomi
      dei piani e le 277 tacche di beat; `⌥`+rotellina
- [x] tratto `i`/`o` e ciclo `l`: lo stesso passaggio dieci volte senza toccare niente
- [x] marcatori con nota (`m`), sul righello e in elenco, in `scelte.json` — verificato che
      `pianifica.py` li ignora e il piano resta identico
- [x] elenco dei tasti in pagina (`?`)
- [x] ispettore: la ripresa in montaggio che gira, e le alternative del suo atto come
      **provini ordinati per scarto dalla durezza del suono** — non piu' una tendina di nomi
- [x] ogni forzatura si annota con un **disfa** accanto, niente `alert()`
- [x] i job persi in un riavvio si riagganciano al loro `prompt_id` invece di restare
      "in corso" per sempre — e girano nel contesto di ogni progetto video
- [x] i piani nati sulla GPU compaiono nell'elenco: l'unione di chi ha i fotogrammi qui e
      chi ha un'anteprima, col conto in `raccolte.json`
- [x] il servizio non muore piu' quando il client e' da ricompilare (`bunx` non e' nel PATH
      di launchd, e `spawnSync` su un eseguibile assente solleva invece di tornare non-zero)
