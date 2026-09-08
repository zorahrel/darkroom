## Why

Darkroom sa rifinire e generare immagini con l'AI, ma non sa la fase che viene **prima**:
prendere le migliaia di scatti che escono da una giornata e sceglierne le centinaia che
meritano di essere lavorate. Oggi quel pezzo manca del tutto — `server/importer.ts:6`
accetta soltanto `jpg`, `jpeg` e `png`, quindi **un RAW non entra nemmeno nel database**.

E dove tocchiamo le immagini lo facciamo con lo strumento sbagliato. `server/thumb.ts:34`
genera ogni anteprima lanciando `sips`, un processo per file, che ignora l'anteprima già
scritta dalla fotocamera dentro il RAW e ri-demosaicizza l'immagine da zero. Misurato su 85
Sony ARW da 47 MB:

| pipeline | ms per foto |
|---|---:|
| `sips`, il nostro codice di oggi | **1859** |
| ImageIO in-process (Swift, solo macOS) | 26,5 seriale · 6,2 parallelo |
| **prototipo Rust scritto per questa proposta** | 24,6 seriale · **7,9 parallelo** |

**235 volte.** Su una cartella da duemila scatti sono 62 minuti contro 16 secondi. Non è una
lentezza da tollerare in attesa di priorità migliori: è la ragione per cui il culling in
Darkroom non si può fare, indipendentemente dall'interfaccia che gli mettiamo davanti.

Esiste un'applicazione che quel pezzo lo risolve — l'app macOS nativa di Luigi Pellecchia
(`github.com/fl4tsigh7/darkroom`), 42.759 righe di Swift, di cui abbiamo autorizzazione
scritta del titolare. Non è un prototipo: ha 18 beta tester in attesa e un sondaggio che
indica una disponibilità di spesa mediana di 17,5 € al mese. Non è un fork del nostro e non condivide un antenato: è un prodotto
diverso, in un altro linguaggio, che risolve la fase complementare alla nostra. Portarlo
dentro non è copiare un ramo, è **acquisire una capability e riscriverla nella nostra
architettura**.

Il vincolo che decide tutto arriva da qui: la loro app è nativa e quindi solo macOS, la
nostra è web e quindi non ha accesso ai file. Il risultato deve essere **una cosa sola con
due gusci** — versione web e applicazione desktop — sopra un core che sia veloce in
entrambi. Nessuna delle due basi di partenza ci arriva da sola.

## What Changes

Un core nativo nuovo, e sette capability che ci si appoggiano.

| # | Capability | Cosa aggiunge |
|---|---|---|
| 1 | `core-nativo` | Crate Rust `darkroom-core`: RAW, anteprime, cache, XMP, grade, firme. Nessuna API macOS. Consumato dal backend Bun (web) e in-process da Tauri (app) |
| 2 | `raw-ingest` | I RAW entrano nel database. Anteprima incorporata, piramide a quattro livelli, cache a budget di byte |
| 3 | `culling` | Griglia, striscia, visore, etichette colore, stelle, raggruppamento burst, criteri di sessione, `Selecta/`, report, ricerca per contenuto |
| 4 | `xmp` | Sidecar XMP letti e scritti accanto ai RAW, con backup obbligatorio e modifica mirata |
| 5 | `sviluppo-locale` | Sviluppo del RAW senza rete, preset, maschere viso/cielo, esportazione JPEG/TIFF |
| 6 | `girato` | Triage del video: griglia clip, fila con timeline, tieni/scarta, taglio, riordino |
| 7 | `superfici` | Guscio desktop Tauri v2, versione web sul backend esistente, **una sola UI React** per entrambi |

Il flusso che ne esce è continuo, e oggi non esiste da nessuna delle due parti: *scarico →
culling → sviluppo locale → rifinitura AI → post e export*. La metà sinistra è loro, la metà
destra è nostra, la giuntura è il punto di questa proposta.

## Impact

- **Struttura**: nasce `core/` (Rust). `server/` lo chiama al posto di `sips`. Nasce
  `app/` (Tauri). `client/` resta uno solo e serve entrambi i gusci.
- **Schema**: le foto acquisiscono formato sorgente, etichetta colore, stelle, gruppo,
  criteri e firma percettiva. Lo storico non ha questi campi e resta valido: NULL significa
  «non giudicata», non «scartata».
- **Compatibilità**: Japan e Profilo devono continuare a funzionare senza toccare un file.
  Le 536 prove verdi di oggi restano verdi.
- **Il file originale non si tocca mai.** Un RAW aperto da Darkroom resta identico al byte.
  Le decisioni vivono nei sidecar e nel database, mai dentro la fotografia.
- **Multipiattaforma**: il core non dipende da macOS, quindi il PC Windows diventa una
  macchina su cui Darkroom gira, non solo una su cui girano i test.

## Non-goals

- **Non si copia codice Swift.** L'autorizzazione copre l'acquisizione della capability; il
  risultato è codice nostro, sotto la nostra licenza. La loro implementazione si legge come
  specifica, non come sorgente da tradurre riga per riga.
- **Niente montaggio video.** Il girato è triage: si sceglie e si sfoltisce, si monta altrove.
- **Nessun ritocco distruttivo.** Darkroom non salva mai sopra l'originale, in nessun ramo.
- **Non si porta la loro UI.** Le 20.300 righe di AppKit e SwiftUI si sostituiscono con la UI
  unica, non si traducono.
- **Nessuna telemetria, nessuna rete nel percorso di lettura delle immagini.** Il ramo AI
  resta l'unico che parla con l'esterno, e resta esplicito.
