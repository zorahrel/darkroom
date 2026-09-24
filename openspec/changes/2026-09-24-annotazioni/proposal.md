## Da decidere

1. **Strumenti: penna libera (rosso/giallo) + una nota di testo, con annulla e cancella** (consigliato): basta a dire «qui» e «così»; frecce e cerchi si fanno a mano libera. Alternativa: anche forme e testo scritto sull'immagine.
2. **Dove: su ogni versione nel dettaglio e su ogni reference** (consigliato): sono i due posti dove oggi mi spieghi a parole cosa non va. Alternativa: solo sulle versioni.
3. **Le annotazioni servono a me, non entrano nelle generazioni** (consigliato): disegnate sopra una generata restano una generata, e la regola dice niente generate come reference. Se una va usata come guida, la ridisegno su una tua foto. Alternativa: allegabili come guida con un clic.
4. **Funziona con dito e Apple Pencil su iPad** (consigliato): è dove guardi le versioni. Alternativa: solo mouse.

ok / ok ma 2 no

## Why

Nel Kaumat la striscia sulla nuca è stata spiegata a parole quattro volte (v09-v16) e non è mai uscita giusta; una guida disegnata da me è stata bocciata («tremenda»). Le corna invece erano uscite al primo colpo appena c'era un segno rosso nel punto giusto. Il collo di bottiglia non è il generatore, è che **tu vedi il punto e io lo ricevo a parole**.

## What Changes

- Nel dettaglio di una versione e nella pagina di una reference, un pulsante **Annota** apre un livello di disegno sopra l'immagine: penna, due colori, annulla, cancella, un campo di testo.
- **Salva** scrive l'immagine con i segni in `data/annotazioni/<foto>/v<N>-<ora>.png` e una riga in una tabella `annotations` (foto, versione o reference, percorso, nota, data).
- Sotto la versione compaiono le sue annotazioni, cliccabili.
- Io le leggo dal database e dal file, senza passare dalla chat.

## Fuori

Niente livelli, niente forme vettoriali, niente modifica di un'annotazione già salvata (se ne fa un'altra), niente strumento MCP: le leggo dal DB.
