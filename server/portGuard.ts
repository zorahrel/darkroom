/**
 * NON RUBARE LA PORTA A UN ALTRO PROGETTO.
 *
 * IL GUASTO, misurato il 2026-08-20 sulla macchina dell'utente. Topics ascolta
 * su `*:3333`, cioe' il bind IPv6 jolly. Darkroom, avviato a mano con
 * `PORT=3333`, si e' legato a `127.0.0.1:3333` — IPv4 esplicito. I due binding
 * sono entrambi legittimi e convivono senza un solo errore: `Bun.serve` non ha
 * dato `EADDRINUSE`, perche' non c'era nessuna collisione da segnalare.
 *
 * Ma il kernel consegna al binding piu' SPECIFICO. Da quel momento ogni
 * connessione a `127.0.0.1:3333` e' finita a Darkroom: Topics rispondeva 200
 * con l'HTML di un altro progetto, e in HTTPS moriva con
 * `tlsv1 alert protocol version` perche' Darkroom non parla TLS. Per NOVE ORE.
 * Il sintomo a schermo era «ci mette un sacco a connettersi» piu' una finestra
 * che non si aggiornava: nessuno dei due dice «hai due server sulla stessa
 * porta».
 *
 * DA CHE PARTE STA IL CONTROLLO. Topics ha una sonda che dice «non sono io a
 * rispondere sulla mia porta» e non uccide niente, giustamente: quel processo
 * e' di qualcun altro. Qui siamo dall'altro lato, e il dovere e' opposto e piu'
 * forte — chi ARRIVA su una porta gia' servita e' l'intruso, e l'unica mossa
 * corretta e' non partire. Darkroom e' una dashboard locale: rinunciare al boot
 * costa un messaggio, rubare la porta costa una giornata a qualcun altro.
 *
 * Perche' `lsof` e non un tentativo di `connect`: un server puo' essere in
 * ascolto e non rispondere ancora (boot lento, TLS), e un `connect` che fallisce
 * direbbe «libera» quando non lo e'. La domanda giusta e' «c'e' un socket in
 * LISTEN su questa porta», e a quella risponde la tabella dei socket.
 */

/** Chi tiene un socket in LISTEN su una porta. */
export interface Occupant {
  pid: number;
  /** La riga di comando, se leggibile: `lsof` con permessi ridotti da' solo il pid. */
  command: string | null;
  /** L'indirizzo del bind, es. `*:3333` o `127.0.0.1:3333`. Serve a spiegare. */
  address: string | null;
}

export type PortOutcome =
  /** Nessuno ascolta: si puo' partire. */
  | { state: "free" }
  /** Ascolta qualcun altro: NON si parte. */
  | { state: "busy"; occupants: Occupant[] }
  /** Non si e' potuto sapere (lsof assente, permessi). Si parte: un controllo
   *  che non sa non ha il diritto di bloccare il lavoro. */
  | { state: "ignoto"; why: string };

export interface GuardiaDeps {
  /** I socket in LISTEN su quella porta, o `null` se non si e' potuto sapere. */
  listeners: (port: number) => Occupant[] | null;
  /** Il nostro pid, per non accusare noi stessi (o un hot-reload di noi stessi). */
  ourPid: number;
}

/** La porta e' libera per noi? */
export function checkPort(port: number, deps: GuardiaDeps): PortOutcome {
  const found = deps.listeners(port);
  if (found === null) {
    return { state: "ignoto", why: "impossibile leggere i socket in ascolto" };
  }
  const altrui = found.filter((o) => o.pid !== deps.ourPid);
  if (altrui.length === 0) return { state: "free" };
  return { state: "busy", occupants: altrui };
}

/**
 * Il messaggio che l'utente legge quando il boot si ferma.
 *
 * Dice il pid e il comando perche' la domanda successiva e' sempre «e adesso
 * quale finestra chiudo»: un «porta occupata» senza un pid la lascia aperta.
 */
export function busyMessage(port: number, occupants: Occupant[]): string {
  const rows = occupants.map((o) => {
    const where = o.address ? ` su ${o.address}` : "";
    const what = o.command ? ` — ${o.command}` : "";
    return `    pid ${o.pid}${where}${what}`;
  });
  return [
    `[porta] NON PARTO: la porta ${port} e' gia' servita da qualcun altro.`,
    ...rows,
    `  Legarsi comunque non darebbe errore (IPv4 e IPv6 convivono) ma ruberebbe`,
    `  il traffico a quel processo, che risponderebbe con la UI sbagliata.`,
    `  Scegli un'altra porta:  PORT=<numero> bun run server/index.ts`,
    `  Oppure chiudi quel processo:  kill ${occupants.map((o) => o.pid).join(" ")}`,
    `  Per forzare comunque (sai cosa stai facendo): DARKROOM_PORT_FORCE=1`,
  ].join("\n");
}

/**
 * `lsof` sui socket in LISTEN di una porta, in output stabile (`-F`).
 *
 * `-sTCP:LISTEN` esclude le connessioni stabilite verso quella porta, che non
 * la occupano; `-nP` evita le risoluzioni DNS e dei nomi di servizio, che
 * costano secondi e non aggiungono niente.
 */
export function realListeners(port: number): Occupant[] | null {
  try {
    const proc = Bun.spawnSync(
      ["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpcn"],
      { stdout: "pipe", stderr: "pipe" },
    );
    // exit 1 senza output = nessuno ascolta: e' un esito, non un errore.
    const text = new TextDecoder().decode(proc.stdout);
    if (!text.trim()) return proc.exitCode === 0 || proc.exitCode === 1 ? [] : null;
    return parseLsof(text, port);
  } catch {
    return null;
  }
}

/**
 * L'output `-F` di lsof: righe con un prefisso di un carattere, raggruppate per
 * processo (`p`/`c`) e poi per file (`n`). Si legge in ordine e si tiene lo
 * stato corrente — un `n` appartiene all'ultimo `p` visto.
 */
export function parseLsof(text: string, port: number): Occupant[] {
  const out: Occupant[] = [];
  let pid: number | null = null;
  let command: string | null = null;
  for (const row of text.split("\n")) {
    if (!row) continue;
    const field = row[0];
    const val = row.slice(1);
    if (field === "p") {
      pid = Number(val);
      command = null;
    } else if (field === "c") {
      command = val;
    } else if (field === "n" && pid !== null) {
      // `n` puo' comparire piu' volte per lo stesso processo (IPv4 e IPv6):
      // sono due binding distinti e vanno mostrati entrambi.
      if (!val.endsWith(`:${port}`)) continue;
      out.push({ pid, command, address: val });
    }
  }
  return out;
}
