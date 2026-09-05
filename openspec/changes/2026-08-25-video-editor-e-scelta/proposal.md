## Why

Il progetto video si monta con una catena Python misurata: i tagli
stanno su beat misurati, la scelta dell'inquadratura segue la durezza misurata, i doppioni
sono impossibili per costruzione. Quello che la catena **non** sa fare è guardare.

Il costo è misurato, non ipotizzato. In due giorni sono serviti quattro giri di revisione
umana per dire quattro cose che si vedono in due secondi guardando una clip:

- `d02` si scioglie nell'onda dal fotogramma 90 — due metriche automatiche provate
  (salto dell'area della sagoma, crescita della macchia scura contro il calo dell'altezza)
  e nessuna delle due la separa da una figura che entra in un'onda: il suo indice sta in
  mezzo al gruppo;
- `g_scal1` ha un buco bianco a blocchi che le cresce sulla schiena;
- `z43_0` e `z43_1` **non sono due riprese**, sono due metà della stessa presa: il
  montaggio contava 122 nomi diversi e le riprese vere erano 48, con quarantanove coppie
  della stessa presa a meno di otto secondi l'una dall'altra;
- le ventisette riprese di volo erano tutte image-to-video partite da un fotogramma di lei
  **in piedi**, quindi il modello la teneva in piedi.

Nessuno di questi è un difetto di generazione: sono tutti **giudizi che devono passare da
un occhio**, e oggi passano dal terminale di chi monta.

Darkroom ha già l'ossatura, ferma al 19/08: `server/video.ts` legge i file del progetto e
scrive `scelte.json`, che `pianifica.py` già rispetta
(`fuori = dict(BANDITI); fuori.update(scelte)`). Da allora la catena è cambiata — atti
narrativi, dedup per origine, movimento pieno a 24 fps, quindici riprese orizzontali nuove
— e Darkroom non lo sa: mostra dati veri di un montaggio che non esiste più.

## What Changes

Tre capability, che chiudono lo stesso ciclo (**guardo → boccio → rifaccio → ricostruisco**):

| # | Capability | Cosa aggiunge |
|---|---|---|
| 1 | `video-scelta` | Una scena alla volta a tutto quadro, con tastiera: tieni / scarta / annota. È il giudizio che nessuna misura sa dare |
| 2 | `video-montaggio` | La timeline sa degli atti e delle origini, dice **perché** un piano è lì, e accetta forzature mirate. La barra di `check.py` si legge in pagina |
| 3 | `video-generazione` | Da una scena bocciata si modifica il prompt e si rigenera sulla 3090, senza terminale |

## Impact

- **File del progetto video**: `scelte.json` guadagna `pin` e `durata` accanto a
  `scartati`/`riprese`/`problemi`. `pianifica.py` scrive `atti.json` e sa esportare
  `esclusi.json`. Nessun formato esistente cambia di significato.
- **Schema Darkroom**: nessuna migrazione. I job di generazione riusano la tabella `jobs`
  con `provider = "comfy"`, accanto a `chatgpt` e `higgsfield`.
- **UI**: una pagina nuova (`/video/scelta`) e l'evoluzione di `/video`.
- **Progetti foto esistenti**: Japan e Profilo non vengono toccati. Le rotte `/api/video/*`
  rispondono solo su progetti `kind: "video"`.

## Non-goals

- **Nessun NLE.** Niente trascina-e-taglia libero. Le garanzie del progetto — tagli sul
  beat misurato, correlazione ρ ≥ 0.85 fra durezza del suono e durezza dell'immagine, zero
  doppioni — esistono perché il montaggio è *derivato* da misure. Un montaggio a mano le
  butta via e nessuna misura può più difenderle. Le forzature restano poche, mirate, e
  dichiarate nel file che il Python legge.
- **Nessun codice di terze parti dentro Darkroom.** Darkroom è MIT e resta scritto qui:
  ogni componente dell'editor — trasporto, striscia dei fotogrammi, testina, ispettore del
  taglio — è codice di questo repo.
- **Nessuna riscrittura della generazione.** Il workflow ComfyUI esiste e funziona in
  `gen.py`; qui si porta invariato, non si reinventa.
- **Nessuna seconda implementazione della barra.** `check.py` resta l'unica misura: la
  pagina la esegue e ne mostra l'uscita.
