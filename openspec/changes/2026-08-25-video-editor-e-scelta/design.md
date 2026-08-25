# Design

## Il confine: chi deriva e chi giudica

La catena Python **deriva** tutto ciò che sa misurare — dove cadono i tagli, quale piano su
quale battuta, quanto dura ciascuno, che due pezzi della stessa presa non si tocchino.
Darkroom **giudica**: tiene, scarta, annota, e forza tre cose che una misura non può
sapere.

Il confine non è ideologico, è pagato. Due metriche automatiche sono state provate per
separare una figura che si deforma da una che entra in un'onda (salto dell'area della
sagoma; crescita della macchia scura contro il calo dell'altezza) e nessuna delle due
separa: l'indice di `d02`, che si scioglie visibilmente, sta in mezzo al gruppo. Quel
giudizio vive davanti a un occhio, e `scelte.json` è il contratto fra i due mondi.

Il contratto esiste già ed è a senso unico: Darkroom scrive, il Python legge
(`fuori = dict(BANDITI); fuori.update(scelte)` in `pianifica.py`). Questo change lo estende
di due campi e non ne cambia nessuno.

```
scelte.json
├── scartati  { piano: motivo }        ← esiste, letto dal Python
├── riprese   { piano: [take fuori] }  ← esiste
├── problemi  { piano: [nota, …] }     ← esiste, nota per il giro dopo
├── pin       { battuta: piano }       ← NUOVO
└── durata    { battuta: battute }     ← NUOVO
```

## Perché servono due file nuovi dal Python

`plan.json` dice quale piano su quale battuta, e basta. Due cose che la UI deve mostrare non
ci sono e non si possono dedurre:

- **`atti.json`** — i confini e i nomi degli atti. Vivono in `ATTI` dentro `pianifica.py`.
  Dedurli dal piano è impossibile: l'atto è la ragione della scelta, non la sua traccia.
- **`esclusi.json`** — i piani banditi con la motivazione scritta. `BANDITI` è un dict con
  le ragioni ("luce alta 2 su 255", "dal fotogramma 90 la figura si scioglie nell'onda") e
  oggi quelle ragioni si leggono solo aprendo il sorgente Python.

Entrambi si scrivono quando il piano si genera. Nessun formato esistente cambia.

## Origine: il difetto che i nomi nascondevano

`origine(k)` = il nome senza le cifre finali. `z43_0` e `z43_1` hanno origine `z43` perché
**sono la stessa presa in due pezzi**. Il montaggio dichiarava 122 riprese diverse e le
origini erano 48.

La funzione vive già in `pianifica.py`. Lato server va replicata identica — una riga di
regex — e usata in due punti: raggruppare la coda della vista di scelta, e mostrare
l'origine nel pannello del taglio. Replicarla è accettabile perché è una definizione, non
una politica; se un giorno cambia, cambia in due posti e i test lo dicono.

## La barra: eseguita, non reimplementata

`/api/video/barra` lancia `check.py` del progetto e ne restituisce l'uscita analizzata in
righe (condizione, valore, verde/rosso). Non ricalcola niente.

La ragione è un difetto reale: la condizione 5 ha misurato per due mesi la cosa sbagliata —
contava i fotogrammi identici al precedente e usciva 0%, ma solo perché con la grana a 20
il rumore da solo superava la soglia su ogni fotogramma. Abbassata la grana è diventata
rossa **sul video migliore**. Una seconda implementazione in TypeScript avrebbe avuto lo
stesso buco senza che nessuno potesse accorgersene, perché avrebbe concordato.

## Generazione: portare il workflow, non riscriverlo

`gen.py` costruisce il grafo ComfyUI e lo posta su `:8188`. Il grafo si porta in TypeScript
**invariato** (stessi nodi, stessi id, stesso negativo di default). Cambia solo chi lo
manda.

Il worker riusa la tabella `jobs` con `provider = "comfy"`. Tre cose che il worker deve
sapere e che sono state pagate misurandole:

1. **La memoria è il limite, non il metodo.** 704×1280 / 81 fotogrammi / nessuna immagine
   di partenza → 23,9 GB su 24,5, un'ora, zero PNG. 640×1152 / 61 / 20 passi / tasselli
   256 → 90 secondi. I parametri sono campi del job.
2. **I PNG escono in `D:\video_out\`**, non nella sottocartella `test\` che
   `pullvid.sh` si aspetta. Il worker usa il percorso vero.
3. **Il ritorno è un file solo.** Si codifica sul PC e si scarica un mp4; 61 PNG su quel
   collegamento costano venti volte tanto.

Il timeout non è un tempo fisso: è "nessun fotogramma prodotto dopo N", perché il modo in
cui questa generazione fallisce è restare al 100% di GPU senza scrivere niente.

## Cosa NON si costruisce, e perché

Un NLE. Non per mancanza di tempo: le garanzie di questo progetto esistono perché il
montaggio è **derivato**. Zero doppioni è vero per costruzione, non per attenzione. ρ ≥
0.85 è vero perché l'assegnazione appaia per rango. Il giorno in cui i tagli si trascinano
a mano, quelle proprietà smettono di essere garantite e nessuna misura può più difenderle —
e la barra diventerebbe un controllo che boccia il lavoro dell'utente invece di guidarlo.

Quello che si costruisce è l'altra metà: **guardare bene ciò che è già stato derivato**. Un
player che sa andare al fotogramma, una striscia di immagini per trovare la ripresa a
occhio invece che a nome, una testina che dice dove sei, e tre forzature dichiarate
(inchioda, durata, escludi) che passano da `scelte.json` e rientrano nel piano dalla porta
principale.

### Il difetto che rendeva inutile tutto il resto

`serveFile` rispondeva `200` con il file intero e senza `accept-ranges`. Un video servito
così **non è cercabile**: `currentTime = 120` non porta a 2:00, riporta la testina a zero.
Clic sulla striscia, passo a fotogramma, trascinamento sulla timeline fallivano tutti
insieme, senza un errore da nessuna parte — l'unica traccia era un `200` dove serviva un
`206`. Misurato dopo la correzione: clic sul 55° riquadro → 124,69s; freccia destra →
+0,042s esatti, cioè un fotogramma a 24; `]` → 126,55s. Sette test coprono i pezzi di file,
suffisso e `416` compresi, perché il modo in cui questo si rompe è silenzioso.
