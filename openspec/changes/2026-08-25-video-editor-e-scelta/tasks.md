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

## 11. Il guscio (26/08, quarta passata)
- [x] la pagina **non scorre**: altezza misurata sul contenitore vero (compreso il suo
      padding, che a occhio lasciava otto pixel) — verificato a 1440×900, 1920×1080, 1280×800
- [x] tre pannelli e la timeline, come in un programma di montaggio: libreria con ricerca
      e filtri a sinistra, monitor al centro dimensionato dall'immagine, ispettore a destra
      che prende lo spazio che avanza invece di lasciarlo nero
- [x] maniglie fra i pannelli e sopra la timeline, misure ricordate nel browser
- [x] **la timeline cresce e le corsie con lei**: trascinando il separatore l'onda passa da
      61 a 103 px, i blocchi e i fotogrammi con lei
- [x] zoom ancorato al punto sotto il cursore: ingrandire e poi dover ritrovare il punto
      è come non aver ingrandito
- [x] riga di hover oltre alla testina, con l'istante in cima
- [x] **contrasti misurati in pagina** sui colori calcolati (Tailwind scrive `oklch`, quindi
      la conversione la fa il browser): `neutral-600` e sotto stanno fra 1.3:1 e 2.5:1, cioè
      illeggibili. Il testo dell'editor ora sta a **7.66:1 o meglio**; restano due elementi
      sotto soglia e sono la `/` e il `▾` del menu dell'app
- [x] barra in cima da 30 a 24 px, padding stretti dove non servivano
- [x] `indiceTaglio`, `altezzeCorsie` e `passoTacche` in `video/tempo.ts`, usati dai
      componenti invece di essere ricopiati — 12 test, **visti diventare rossi** mutando
      `<=` in `<` e bloccando una corsia
- [x] batteria a 16 controlli sull'interfaccia vera: clic sul taglio, passo a 1/24 esatto,
      `]`, tratto, tasti, esc, maniglia, zoom, scelta a schermo pieno, zero errori in console

## 12. Niente si cambia in silenzio (26/08)
Un clic di troppo su un provino aveva inchiodato la battuta 58.5 a `w_largo`, e non
c'era modo di accorgersene: la forzatura viveva solo dentro `scelte.json`. Il difetto
non era il clic, era che una modifica invisibile è una modifica che non si può disfare.
- [x] il provino nell'ispettore **sceglie**, non scrive: apre un confronto fianco a
      fianco con un bottone che dice per esteso cosa farà («metti w_alto al posto di
      w_taglio»)
- [x] `GET /api/video/forzature` elenca tutto ciò che sta sopra il piano derivato —
      inchiodature, durate forzate, scarti fatti a mano
- [x] contatore nella barra in cima, e un elenco con «togli» / «rimetti» su ogni voce
- [x] i tagli inchiodati portano un segno azzurro sulla timeline
- [x] nella Scelta l'ultimo verdetto resta scritto in cima con il suo **annulla · z**,
      che rimette ogni pezzo com'era e torna sulla scena per riguardarla
- [x] verificato: clic sul provino → zero pin sul disco; bottone → un pin; «togli» →
      zero. Nella Scelta: freccia → l'annulla compare, `z` → sparisce

## 13. Un progetto video non è un progetto foto (26/08)
- [x] `/p/<progetto>` di un progetto video porta al montaggio: mostrava la griglia delle
      foto vuota, con «aggiungi una cartella di foto» e il pannello di sviluppo — cioè
      l'interfaccia di un altro mestiere
- [x] il menu in cima diventa **Montaggio · Scelta**, e nasconde Griglia/Albero/Riferimenti
- [x] i progetti foto restano identici: Japan si apre sulla griglia con le sue voci
- [x] i «tieni» adesso si registrano: `scelte.json` tiene anche `tenuti` con il quando, e
      `pianifica.py` li ignora (piano identico, verificato)
- [x] Scelta: filtri `da giudicare N · tenute · scartate · annotate · in montaggio · tutte`
      e i conteggi in cima; il pannello distingue «mai giudicata» da «tenuta»; «scorda il
      voto» rimette una presa in coda

## 14. La timeline si modifica (26/08)
La regola era: il montaggio è derivato, quindi non si trascina. Restava vero il perché
(zero doppioni e ρ ≥ 0.85 valgono *per costruzione*), ma la conclusione era sbagliata —
si può trascinare, purché ogni gesto scriva una **forzatura dichiarata** invece di una
modifica muta. Il piano resta derivato; quello che lo scavalca è scritto, visibile e
reversibile.
- [x] **trascinare un blocco sopra un altro**: i due si scambiano di posto. Un solo
      scambio scritto in una volta (`POST /api/video/scambia`), così l'annulla rimette
      entrambi o nessuno. Muovere «un po' più in là» non esiste: i tagli stanno su battute
      misurate e ogni battuta ne regge uno
- [x] **tirare il bordo destro**: quante battute dura, a passi di mezza battuta — fra una
      e l'altra non c'è niente che il montaggio sappia rappresentare
- [x] **trascinare un piano dalla libreria** su un taglio: lo inchioda lì
- [x] la modifica **si vede subito**: le inchiodature si applicano al piano mostrato,
      esatte perché non cambiano i tempi. La durata invece sposterebbe tutto ciò che
      viene dopo, e fingere quel ricalcolo mostrerebbe un montaggio che non esiste: quella
      si dichiara sul blocco con un'etichetta
- [x] pila di annulla (`z`, e il bottone in barra dice cosa disfa): ogni modifica sa la
      propria inversa, quindi l'annulla non ricostruisce uno stato — rifà la mossa al
      contrario
- [x] verificato: scambio → 2 pin sul disco e i blocchi scambiati a schermo → `z` → zero
      pin e blocchi com'erano · bordo → durata dichiarata → `z` → tolta · libreria →
      inchiodato e mostrato → `z` → tolto. 16 controlli, zero errori in console
