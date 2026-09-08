# Design — core nativo, culling, due gusci

## La decisione, e i numeri che la reggono

Tutte le misure sono su 85 Sony ARW da 47 MB (42 MP), Mac a 12 core, page cache scaldata
nello stesso modo per ogni concorrente. Il prototipo Rust è stato scritto, compilato ed
eseguito per questa proposta, non stimato.

| pipeline | seriale | parallelo | portabilità |
|---|---:|---:|---|
| `sips` (nostro codice oggi) | 1859 ms | — | ovunque, ma inutilizzabile |
| ImageIO in-process (Swift) | 26,5 ms | 6,2 ms | **solo macOS** |
| Rust: IFD TIFF + zune-jpeg + fast_image_resize | 24,6 ms | **7,9 ms** | macOS, Windows, Linux |

Il residuo contro ImageIO sta tutto nel ridimensionamento: chiedendo solo la decodifica
dell'anteprima incorporata il Rust scende a **2,2 ms per file in parallelo**. Si chiude
decodificando il JPEG a scala DCT invece che a piena risoluzione per poi rimpicciolire.

### La trappola che cambia il progetto

`kCGImageSourceThumbnailMaxPixelSize` è un **tetto, non un minimo**, e loro l'hanno
documentata. Ma la conseguenza vera si vede solo misurando su corpi diversi dai loro:

- sulle **NEF Nikon** l'anteprima incorporata è grande quanto lo scatto → il visore a 3840 px
  costa quanto la griglia, ed è da lì che nasce il loro «33 ms»;
- sulle **ARW Sony** l'anteprima incorporata si ferma a **1616 px** → chiedere 3840 px
  restituisce 1616, e per averne davvero 3840 serve la decodifica piena: **770 ms per foto,
  e parallelizzare non guadagna niente** (seriale 770, parallelo 779 — ImageIO satura già i
  core da sola).

Quindi il livello visore non è un caso facile con una costante da alzare: è il collo di
bottiglia vero, cambia da fotocamera a fotocamera, e va misurato sulla cartella in esame
prima di scegliere una soglia. Il core SHALL riportare la dimensione dell'anteprima
incorporata prima di qualunque numero di tempo.

## Architettura: un core, tre superfici

```text
                    ┌───────────────────────────┐
                    │   core/  (Rust, no macOS) │
                    │  RAW · anteprime · cache  │
                    │  XMP · grade · firme      │
                    └─────┬───────────────┬─────┘
                    FFI   │               │  in-process
                          │               │
              ┌───────────▼──────┐  ┌─────▼──────────┐
              │ server/ (Bun)    │  │ app/ (Tauri v2)│
              │ + ramo AI        │  │ desktop        │
              └───────────┬──────┘  └─────┬──────────┘
                          │  HTTP         │  IPC
                          └───────┬───────┘
                            ┌─────▼─────┐
                            │ client/   │  UNA sola UI React
                            └───────────┘
```

Il core non conosce né HTTP né interfacce: espone funzioni. Chi lo chiama decide se farlo
attraverso una porta o dentro il proprio processo.

## Perché così, e non altrimenti

**Perché non tenere Swift.** È la strada più corta al risultato e la sola che chiuderemmo
subito, ma costa le due cose che sono state chieste: la versione web sparisce (AppKit non ha
un guscio browser) e Windows sparisce con essa. In più diventerebbero due interfacce da
mantenere, e la richiesta era esplicitamente il contrario.

**Perché non Electron.** Loro l'hanno scartato su numeri: 220 MB di bundle contro 4,9, e
soprattutto l'estrazione delle anteprime tornerebbe a essere un sottoprocesso per file — cioè
di nuovo il difetto da 1859 ms che stiamo togliendo. Tauri tiene la UI web e mette il core
nello stesso processo: il percorso caldo non attraversa nessun confine.

**Perché Rust e non C++.** Il percorso caldo *parsa file binari che non abbiamo scritto noi*.
TIFF e RAW sono una superficie da vulnerabilità storica e libraw ne ha collezionate in
quantità; qui un file malformato di un cliente non deve poter diventare altro che un errore.
A questo si aggiunge che Tauri, i binding napi verso Bun e il target WASM sono di prima
classe in Rust e da inventare in C++. C++ resta solo dove dobbiamo linkare libraw per la
decodifica piena, isolato dietro un'interfaccia.

**Perché il core e non «ottimizziamo `sips`».** Non c'è niente da ottimizzare: il costo è
l'avvio di processo più una demosaicizzazione che non serviva. Anche parallelizzando `sips`
resteremmo a centinaia di millisecondi contro 7,9.

## Le tre dipendenze macOS da sciogliere, in ordine di difficoltà

| dipendenza | dove | uscita | rischio |
|---|---|---|---|
| `ImageIO` / `CGImageSource` | 4 file | **già risolta**, prototipo Rust girato | nessuno |
| `AVFoundation` | 7 file | ffmpeg, che è già una nostra dipendenza | basso |
| `Vision` + `CoreML` (`VisoParsing`, `CieloScena`) | 8 file | ONNX Runtime; i modelli si esportano con coremltools | medio: l'export va verificato, non dato per fatto |
| **`CIRAWFilter`** | 6 file | libraw + pipeline di sviluppo nostra | **alto — è il pezzo duro** |

`CIRAWFilter` è l'unica per cui non esiste un rimpiazzo che si accende e funziona: è una
pipeline di sviluppo completa (demosaicizzazione, bilanciamento, tono, colore) che macOS
regala. Rifarla in Rust è territorio darktable, e non si finisce in una settimana. Per questo
lo sviluppo locale è l'ultima traccia e ha una via d'uscita dichiarata: su macOS si può
chiamare `CIRAWFilter` dietro l'interfaccia del core finché la versione portabile non regge il
confronto, purché il confine sia una sola funzione e la resa venga confrontata a immagine, non
a parole.

## Cosa NON si porta

Delle 42.759 righe, la ripartizione decide il preventivo:

| | righe | file | destino |
|---|---:|---:|---|
| `Sviluppo/` | 13.814 | 29 | **la traccia più grande**: 79 cursori su CIRAWFilter |
| radice (galleria, anteprime, XMP, gruppi, Selecta, Vision, diagnostica) | 20.318 | 57 | logica da portare, meno la UI |
| `Girato/` | 3.456 | 11 | porta |
| `Maschere/` | 2.760 | 6 | porta, con i due modelli CoreML |
| `Ricerca/` | 1.212 | 5 | porta |
| `Automatico/` | 1.199 | 2 | porta |
| di cui **UI pura** (viste, menu, tema, tastiera) | −9.910 | 23 | **si sostituisce** |
| di cui **Check e Gate** (test e diagnostica) | −9.946 | — | si riscrive come test nostri |
| **logica applicativa netta da portare** | **~22.900** | | |

Le 9.910 righe di guscio — finestre, menu, viste SwiftUI, gestione tastiera — non hanno
destinazione: la UI unica le sostituisce. Portarle sarebbe tradurre un'interfaccia per poi
buttarla. Quello che si porta da lì sono le **decisioni**: quattro livelli di anteprima e non
uno, cache separate per livello perché una sola le fa litigare, l'anteprima che non lascia mai
una casella vuota. Sono conclusioni pagate con misure, e valgono anche in un altro linguaggio.

Le 9.946 righe di Check e Gate non si portano ma non si buttano: sono 549 controlli di
regressione sull'interfaccia e 70 sull'XMP, cioè l'elenco scritto di ciò che si è già rotto una
volta. Diventano test nostri, ed è il modo più economico che abbiamo di non ripagare gli stessi
errori.

## Cosa può andare storto

- **L'export CoreML → ONNX può non essere fedele.** Va verificato su immagini vere
  confrontando le maschere prodotte, prima di costruirci sopra. Se non regge, le maschere
  restano macOS-only per una release e il resto procede: non bloccano niente.
- **Lo sviluppo RAW portabile può non raggiungere la qualità di macOS.** È il rischio
  accettato sopra, con la via d'uscita dichiarata.
- **La UI unica può diventare due UI travestite da una.** Il culling e l'editing AI hanno
  ritmi diversi: uno è tastiera e migliaia di scatti, l'altro è mouse e poche immagini. Il
  fallimento specifico da sorvegliare è una griglia che serve male entrambi per servirli
  tutti e due; il segnale è la comparsa del terzo `if` sul tipo di vista.

## Trappole già pagate, che non ripagheremo

Nove errori documentati nel loro handoff. Non sono curiosità: sono la ragione per cui
acquisire una capability matura costa meno che riscriverla, e ognuno diventa un requisito o
un test invece di una nota.

**Il decoder RAW di sistema uccide il processo.** Su un file corrotto RawCamera non fallisce:
manda `EXC_BREAKPOINT` e porta giù l'applicazione, e dall'intestazione non si può prevedere.
L'unico rimedio trovato è decodificare in un sottoprocesso sacrificabile — costo 5-7% su un
ridisegno, e come effetto collaterale il picco di RAM scende da 644 a 310 MB.

**Un RAW corrotto restituisce la foto precedente.** A freddo dà un fotogramma nero, ma a
pipeline calda restituisce *l'immagine di prima*: stesso soggetto, posa diversa. È il difetto
peggiore del catalogo, perché non sembra un errore — si giudica lo scatto A guardando lo
scatto B. E la correzione istintiva («riprova finché non è nera») è sbagliata: si guarda il
massimo, non la media, perché una notturna vera ha media zero senza essere rotta.

**Il JPEG dell'anteprima ha la precedenza sul RAW.** Se la cartella delle anteprime non viene
saltata durante l'indicizzazione, dalla seconda apertura in poi il visore mostra il JPEG da
1568 px credendo di mostrare il RAW.

**Il voto sui volti non regge sotto i 1568 px.** L'accordo con il riferimento è r=0,08 a 256 px
e r=0,38 a 512: sotto quella soglia il numero esiste e non significa niente. La
classificazione della scena invece è identica a 512 px in 24 casi su 24 — sono due soglie
diverse e vanno tenute diverse.

**Una copertura corretta non dice niente sulla forma.** La prima maschera del volto passava
tutti i controlli automatici con buchi larghi quanto la faccia e la mascella poligonale. Serve
il provino ingrandito guardato da un umano: la percentuale non lo sostituisce.

**Invertire una maschera va fatto in spazio gamma.** In lineare il complemento di 128 usciva
229, e sommando due maschere si arrivava a 375 su 255.

**I numeri di prestazione si prendono sul binario che si consegna.** In build di sviluppo lo
stesso codice dava 7 ms dove in release ne dava 22.

**Un bersaglio si misura sulla pipeline che lo applicherà.** Il valore di esposizione della
pelle era stato tarato sugli export Camera Raw del fotografo, che portano anche il suo gusto
di grading: numero giusto, scala sbagliata.

**Precampionare batte ricampionare.** Interpolare una curva per punti chiamando `sample()` a
ogni nodo costava 32 ms contro 0,91 di una tabella da 1024 letta una volta — 35 volte, per
zero guadagno.
