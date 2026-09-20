/**
 * Rifinire luce e colore su un render gia' corretto, con Codex invece del browser.
 *
 * PERCHE' ESISTE, due motivi indipendenti.
 *
 * 1. IL BACKEND CDP NON PUO' PIU' GIRARE SU QUESTA MACCHINA. Chrome e' stato
 *    tolto dal Mac (`/Applications/Google Chrome.app` non esiste, nessun
 *    processo sulla 19223, `/api/browser/launch` risponde "No Chrome/Chromium
 *    found"). Il worker CDP automatizza la web app di ChatGPT dentro un Chrome
 *    dedicato: senza Chrome non parte, e tutte le ricette di questo progetto
 *    passavano di li'. Codex CLI (`/opt/homebrew/bin/codex`, backend gia'
 *    previsto dal README) genera senza finestra.
 *
 *    NB: `CODEX_BIN` di default punta a `/Applications/Codex.app/...`, che qui
 *    non c'e'. Va passato esplicito, ed e' il motivo per cui il primo tentativo
 *    e' uscito `codex binary not found`.
 *
 * 2. CODEX IGNORA GLI ALLEGATI (`worker-codex.ts`: "extra references are
 *    ignored"), e per una volta non e' un problema: qui la materia e' un render
 *    gia' fatto, quindi l'identita', gli occhiali, la posa e il fondo sono
 *    DENTRO l'immagine di partenza. Gli allegati servivano a portare quelle
 *    cose; qui restano solo luce e colore, che si chiedono a parole.
 *
 * DA DOVE PARTE. Da v141, che il 15/09 e' stata la prima in venticinque tiri a
 * passare il cancello della direzione della luce (+8,3 alto-basso, dove la
 * reference sta a +19,8 e tutto il resto del progetto stava in negativo). Quel
 * risultato si ottiene togliendo dagli allegati le due foto illuminate dal
 * basso, ed e' esattamente per questo che v141 e' anche SCURA e senza colore:
 * quelle due foto portavano l'esposizione e il ciano insieme alla luce sbagliata.
 *
 * Quindi il difetto residuo non e' strutturale — e' una rifinitura su
 * un'immagine che ha gia' la geometria giusta. Ed e' il caso in cui una passata
 * di edit funziona: il 14/09 la stessa forma su v128 era fallita perche' le
 * si chiedeva di RIBALTARE la direzione, che e' un fatto strutturale.
 *
 * COSA MISURA, e cosa e' successo davvero (tre passate, misure reali):
 *
 *     passata                alto-basso   L viso   % ciano
 *     reference                  +19,8     40,3     26,7%
 *     v141 (partenza)             +8,3     18,7      1,9%
 *     1 (esposizione+colore)      +8,6     26,6      7,4%
 *     2 (esposizione decisa)      +5,7     38,5      8,9%
 *
 * L'esposizione arriva a bersaglio in due passate (18,7 -> 38,5 contro 40,3).
 * La direzione regge — resta ALTA tutte e tre le volte, e si fa pure piu'
 * simmetrica della partenza (sx-dx da +2,3 a -0,1, la reference sta a -4,1).
 * Il colore sale ma lentamente: e' l'asse piu' duro anche qui.
 *
 * PERCHE' UNA PASSATA PER ASSE E NON UNA SOLA CON TUTTO DENTRO. Alla prima
 * passata ho chiesto esposizione e colore insieme e ha mosso poco entrambi
 * (+7,9 di L, +5,5 di ciano). Separandoli — una passata che dice "l'esposizione
 * e' gia' giusta, non toccarla" e chiede solo il colore — ogni richiesta non ha
 * l'altra con cui competere. E' la stessa lezione dello stacco viso/fondo:
 * detto come relazione singola si muove, detto in mezzo ad altro no.
 *
 * COSA NON FA: non tocca l'identita'. Se il viso cambia, la passata e' da
 * buttare — il controllo e' `moondream` sulla descrizione del soggetto, e dopo
 * due passate rispondeva ancora "young man with black wraparound sunglasses, a
 * beard and a dark top... face looks natural and healthy, not waxy or plastic".
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runWorkerCodex } from "../server/worker-codex.ts";
import { dirsFor, withProject } from "../server/project.ts";

/** Un asse per passata. L'ordine conta: l'esposizione prima, perche' il colore
 *  di una zona buia non si legge — e la passata sul colore puo' allora dire
 *  "non toccare l'esposizione", che e' l'istruzione che la tiene ferma. */
const PASSATE: Array<{ nome: string; prompt: string }> = [
  {
    nome: "esposizione",
    prompt:
      "Ritocca SOLO luce e colore, niente altro. 1) ESPOSIZIONE: il viso e' troppo " +
      "scuro, alzalo di circa uno stop e mezzo: deve risultare luminoso e ben esposto, " +
      "come un ritratto da studio, non in penombra. 2) COLORE DELLA LUCE: la sorgente e' " +
      "un softbox con gel AZZURRO-CIANO puntato da davanti e dall'alto; i riflessi su " +
      "fronte, zigomi, naso e mento devono essere visibilmente ciano, mentre l'incarnato " +
      "caldo resta solo nelle zone in ombra. Non cambiare posa, inquadratura, occhiali, " +
      "capelli, vestiti o sfondo, e non cambiare da dove arriva la luce: resta alta e frontale.",
  },
  {
    nome: "colore",
    prompt:
      "Cambia SOLO il colore della luce, non toccare nient'altro. L'esposizione e' gia' " +
      "giusta: non schiarire ne' scurire. La lampada che illumina il viso ha un gel " +
      "AZZURRO-CIANO forte: tutte le zone illuminate del viso — fronte, zigomi, dorso del " +
      "naso, mento, lato illuminato del collo — devono virare visibilmente al ciano, come " +
      "sotto una luce da studio colorata. Solo le zone in ombra conservano l'incarnato " +
      "caldo. Voglio che circa un quarto della pelle risulti decisamente azzurrata. Non " +
      "cambiare posa, inquadratura, occhiali, capelli, vestiti, sfondo, ne' la direzione " +
      "della luce, che resta alta e frontale.",
  },
];

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
};

await withProject("profilo", async () => {
  const { gen } = dirsFor();
  const partenza = arg("da", join(gen, "1", "v141.png"));
  if (!existsSync(partenza)) throw new Error(`materia mancante: ${partenza}`);

  const quali = arg("passate", "esposizione,colore").split(",");
  let corrente = partenza;

  for (const nome of quali) {
    const p = PASSATE.find((x) => x.nome === nome.trim());
    if (!p) throw new Error(`passata sconosciuta: ${nome} (ho: ${PASSATE.map((x) => x.nome).join(", ")})`);

    const out = join("/tmp", `rifinitura-${p.nome}-${Date.now()}.png`);
    console.log(`[rifinitura] ${p.nome}  da ${corrente.split("/").pop()}`);
    const r = await runWorkerCodex({ image: corrente, prompt: p.prompt, output: out } as never);
    if ((r as { status: string }).status !== "ok") {
      // Si ferma: una passata fallita lascia l'immagine allo stadio precedente,
      // e incatenare la successiva su quello significherebbe applicare due volte
      // la stessa correzione senza accorgersene.
      throw new Error(`passata "${p.nome}" fallita: ${JSON.stringify(r)}`);
    }
    console.log(`[rifinitura] ${p.nome}  -> ${out}`);
    corrente = out;
  }

  console.log(`\nrisultato: ${corrente}`);
  console.log(`misura con: python3 scripts/key_direction.py <reference> ${corrente}`);
});
