## Da decidere

1. **Striscia di miniature in basso sotto l'anteprima, sempre visibile a ogni larghezza, una per versione con numero e stellina se preferita** (consigliato): oggi le versioni stanno nel carosello, che sotto i 1024 px finisce in una scheda. Alternativa: solo sopra i 1024 px.
2. **Ordine cronologico, la più nuova a destra, con la striscia già scorsa fino in fondo** (consigliato): si legge come una pellicola e l'ultima è sotto il pollice. Alternativa: la più nuova a sinistra.
3. **Aprendo una foto si vede l'ultima generata, non la preferita** (consigliato): è quella che vuoi giudicare appena esce. La preferita resta segnata con la stellina e `?v=` continua a funzionare. Alternativa: resta la preferita come oggi.
4. **Le versioni ritoccate a mano (zanne, striscia) mostrano un piccolo segno «ritocco»** (consigliato): così non si confondono con le generate pulite. Alternativa: nessun segno.

ok / ok ma 2 no

## Why

Guardando il Kaumat (72 versioni) ogni versione nuova va aperta a mano col link `?v=`: il carosello non si vede sotto i 1024 px, e all'apertura parte la preferita, non l'ultima.

## What Changes

- `client/src/pages/Detail.tsx`: all'apertura si seleziona l'ultima versione (resta `?v=`).
- Nuovo componente striscia sotto l'anteprima di `PhotoPipeline`: miniature `thumbGenUrl(…, 160)`, clic = cambia versione, freccia sinistra/destra continuano a funzionare, scroll automatico sulla selezionata.
- Etichetta «ritocco» per le versioni con `lineage.recipe` che non viene dal generatore.

## Fuori

Niente riordino a mano, niente cancellazione dalla striscia, niente confronto affiancato.
