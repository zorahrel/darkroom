# Tasks — core nativo, culling, due gusci

Convenzione: `[ ]` da fare, `[x]` fatto+verificato.

**Stato: approvata l'8 settembre 2026, tracce 0-3 consegnate.**

Misure raccolte sul percorso, che valgono piu' dei numeri di partenza:

| | prima | dopo |
|---|---:|---:|
| anteprima griglia, 85 ARW da 47 MB, in parallelo | 1859 ms (`sips`) | **2,1 ms** |
| anteprima visore 3840 px, con decodifica piena | non disponibile | 868 ms |
| formati indicizzati | 3 | 30 |
| prove | 536 | **596** + 65 nel motore |

Due cose scoperte misurando, non leggendo:

- l'anteprima incorporata di una **Sony ARW si ferma a 1616 px**, quindi il livello
  visore cade sempre nella decodifica piena; su una NEF non succede. La soglia va
  misurata sulla cartella, mai fissata come costante.
- la prima impronta percettiva **non separava niente** (mediana 30 bit su 64 fra
  scatti della stessa raffica contro 32 fra scene diverse, cioe' il caso): campionava
  singoli pixel invece di mediare i riquadri.

## Barra (si scrive ora, si esegue sempre uguale)

Ciò che è verde resta verde:
- `bun run typecheck` esce zero
- `bun test` esce zero — **536 pass, 0 fail, 33 file** è il riferimento del 2026-09-08
- Japan (190 foto, 1647 versioni) e Profilo si aprono in griglia senza immagini rotte

Ciò che deve diventare vero:
- `cargo test` del core esce zero su macOS **e** su Windows (`zorah@100.92.197.74`)
- Anteprima griglia 512 px su 85 ARW: **≤ 10 ms per foto in parallelo** (oggi `sips`: 1859)
- Diagnosi cartella: riporta la dimensione dell'anteprima incorporata **prima** dei tempi
- Un RAW troncato e uno con offset fuori dai limiti: errore dichiarato, nessun panico,
  l'indicizzazione prosegue sugli altri file
- Impronta SHA di un RAW invariata dopo etichettatura, sviluppo ed esportazione
- Un XMP scritto da Lightroom conserva le sue impostazioni dopo che Darkroom vi scrive
  un'etichetta, e il backup esiste
- Confronto pixel fra pipeline di sviluppo portabile e di sistema: artefatto salvato, sotto la
  soglia dichiarata
- Pacchetto dell'app e memoria a riposo: due numeri riportati a ogni compilazione
- Un RAW che fa morire il decoder: l'app resta viva, quel file è dichiarato illeggibile
- Uno scatto corrotto dopo uno valido **non** mostra il contenuto di quello valido
- Una notturna legittima non viene scambiata per uno scatto rotto
- Una cartella riaperta la seconda volta ha lo stesso numero di scatti della prima
- Un XMP con cronologia Camera Raw: cronologia invariata byte per byte dopo la scrittura
- Le misure di prestazione dichiarano la compilazione con cui sono prese
- **Video** della griglia scorsa su duemila scatti senza celle vuote — è il comportamento, e a
  parole non si dimostra

## 0. Fondamenta (blocca tutto il resto)
- [x] 0.1 `core/` come crate Rust, compilazione su macOS e Windows, `cargo test` in CI
- [x] 0.2 Confine col backend Bun: FFI o processo, deciso su misura e non a preferenza
- [x] 0.3 Estrattore anteprima incorporata, promosso dal prototipo a codice con test
- [x] 0.4 Casi malformati: RAW troncato, offset oltre la fine, IFD ciclico
- [x] 0.5 Decodifica piena in processo sacrificabile, e nessuna immagine precedente
      restituita al posto di una illeggibile

## 1. RAW dentro (dipende da 0)
- [x] 1.1 Formati RAW nell'importer accanto a JPEG/PNG/HEIC/TIFF
- [x] 1.2 Coppia RAW+JPEG riconosciuta come uno scatto solo
- [x] 1.3 `server/thumb.ts` chiama il core, `sips` esce dal progetto
- [ ] 1.4 Piramide a quattro livelli con budget in byte separati per livello
- [x] 1.5 Diagnosi cartella: anteprima incorporata, tempi per livello, misurati lì
- [x] 1.6 Le cartelle di anteprime di Darkroom escluse dall'indicizzazione

## 2. Culling (dipende da 1)
- [x] 2.1 Etichette colore e stelle da tastiera, con filtro della ripetizione automatica
- [x] 2.2 Raggruppamento raffiche + correzione manuale, salvata solo se esiste
- [ ] 2.3 Criteri di sessione obbligatori, nessuna eredità dal lavoro precedente
- [ ] 2.4 Raccolta delle scelte in cartella, con ritorno indietro
- [x] 2.5 Rendiconto di fine culling
- [ ] 2.6 Ricerca per contenuto, che dichiara quando l'analisi non è stata eseguita

## 3. XMP (dipende da 1, indipendente da 2)
- [x] 3.1 Lettura di XMP scritti da altri programmi
- [x] 3.2 Scrittura con backup, modifica mirata, validazione, sostituzione atomica
- [x] 3.3 Conferma informata: quanti file, dove, prima di scrivere
- [x] 3.4 Scanner limitato alla `rdf:Description` che dichiara `xmp:`, mai al file intero
- [x] 3.5 Vocabolario etichette per lingua, dichiarato

## 4. Superfici (dipende da 1; la UI si disegna in parallelo a 2)
- [ ] 4.1 Guscio Tauri v2 che monta il `client/` esistente
- [ ] 4.2 Core in-process nell'app: nessuna richiesta HTTP per le anteprime
- [ ] 4.3 UI unica: culling ed editing AI nella stessa base, senza secondo componente
- [ ] 4.4 Giuntura: dagli scatti tenuti alla coda AI senza giro su disco
- [ ] 4.5 La versione web dichiara ciò che richiede il disco locale
- [ ] 4.6 Peso pacchetto e memoria a riposo riportati a ogni compilazione

## 5. Girato (dipende da 0, indipendente da 2/3/4)
- [ ] 5.1 Frame e durate via ffmpeg, al posto di AVFoundation
- [ ] 5.2 Griglia clip e fila con timeline video e audio
- [ ] 5.3 Tieni/scarta, attacco e stacco, riordino
- [ ] 5.4 Scelte accanto alle clip, scritte prima di chiudere e prima di uscire
- [ ] 5.5 Silenzio dichiarato invece di silenzio e basta

## 6. Sviluppo locale (ultimo: è il pezzo duro)
- [ ] 6.1 Interfaccia di sviluppo con un solo punto di scelta fra pipeline
- [ ] 6.2 Pipeline di sistema dietro quell'interfaccia, come riferimento da battere
- [ ] 6.3 **Verifica export CoreML → ONNX dei due modelli**, su immagini vere, prima di
      costruirci sopra. Se non regge: maschere solo macOS per una release, e si prosegue
- [ ] 6.4 Maschere viso e cielo, combinabili, con bordo sfumato
- [ ] 6.5 Regolazioni salvate come numeri, file creato solo se serve
- [ ] 6.6 Esportazione JPEG/TIFF con dichiarazione preventiva
- [ ] 6.7 Pipeline portabile, confrontata a immagine con quella di sistema

## 7. Recupero dei controlli esistenti
- [ ] 7.1 Le 549 regressioni d'interfaccia e le 70 su XMP, lette come elenco di ciò che si è
      già rotto, diventano test nostri dove il comportamento è lo stesso

## Ordine e perché

`0` blocca tutto. `1` è il guadagno che si vede subito ed è il solo che migliora anche chi
usa Darkroom oggi. `2`, `3`, `5` procedono in parallelo. `4` può partire appena `1` regge, ed
è dove la UI unica va disegnata invece che assemblata. `6` è ultimo perché `CIRAWFilter` è
l'unica dipendenza senza rimpiazzo pronto, e perché è l'unica traccia che può fallire senza
fermare le altre.
