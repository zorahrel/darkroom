/**
 * DO NOT STEAL ANOTHER PROJECT'S PORT.
 *
 * THE FAILURE, measured on 2026-08-20 on the user's machine. Topics listens on
 * `*:3333`, that is the IPv6 wildcard bind. Darkroom, started by hand with
 * `PORT=3333`, bound to `127.0.0.1:3333` — explicit IPv4. Both binds are
 * legitimate and coexist without a single error: `Bun.serve` did not raise
 * `EADDRINUSE`, because there was no collision to report.
 *
 * But the kernel delivers to the most SPECIFIC bind. From that moment every
 * connection to `127.0.0.1:3333` went to Darkroom: Topics answered 200 with
 * another project's HTML, and over HTTPS it died with
 * `tlsv1 alert protocol version` because Darkroom does not speak TLS. For NINE
 * HOURS. On screen the symptom was "it takes forever to connect" plus a window
 * that would not refresh: neither of them says "you have two servers on the
 * same port".
 *
 * WHICH SIDE THE CHECK BELONGS TO. Topics has a probe that says "it is not me
 * answering on my port" and kills nothing, rightly: that process belongs to
 * somebody else. Here we are on the other side, and the duty is the opposite
 * one and stronger — whoever ARRIVES at a port already served is the intruder,
 * and the only correct move is not to start. Darkroom is a local dashboard:
 * giving up the boot costs a message, stealing the port costs somebody else a
 * day.
 *
 * Why `lsof` and not an attempted `connect`: a server can be listening and not
 * answering yet (slow boot, TLS), and a `connect` that fails would say "free"
 * when it is not. The right question is "is there a socket LISTENing on this
 * port", and the socket table is what answers it.
 */

/** Who holds a socket LISTENing on a port. */
export interface Occupant {
  pid: number;
  /** The command line, when readable: `lsof` with reduced permissions gives only the pid. */
  command: string | null;
  /** The bind address, e.g. `*:3333` or `127.0.0.1:3333`. It is there to explain. */
  address: string | null;
}

export type PortOutcome =
  /** Nobody is listening: we can start. */
  | { state: "free" }
  /** Ascolta qualcun altro: NON si parte. */
  | { state: "busy"; occupants: Occupant[] }
  /** Non si e' potuto sapere (lsof assente, permessi). Si parte: un controllo
   *  che non sa non ha il diritto di bloccare il lavoro. */
  | { state: "ignoto"; why: string };

export interface GuardiaDeps {
  /** The LISTENing sockets on that port, or `null` if we could not find out. */
  listeners: (port: number) => Occupant[] | null;
  /** Our own pid, so we do not accuse ourselves (or a hot-reload of ourselves). */
  ourPid: number;
}

/** Is the port free for us? */
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
 * The message the user reads when the boot stops.
 *
 * It names the pid and the command because the next question is always "so
 * which window do I close": a "port busy" without a pid leaves it open.
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
 * `lsof` over a port's LISTENing sockets, in stable output (`-F`).
 *
 * `-sTCP:LISTEN` leaves out established connections towards that port, which do
 * not occupy it; `-nP` avoids DNS and service-name lookups, which cost seconds
 * and add nothing.
 */
export function realListeners(port: number): Occupant[] | null {
  try {
    const proc = Bun.spawnSync(
      ["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpcn"],
      { stdout: "pipe", stderr: "pipe" },
    );
    // exit 1 with no output = nobody is listening: an outcome, not an error.
    const text = new TextDecoder().decode(proc.stdout);
    if (!text.trim()) return proc.exitCode === 0 || proc.exitCode === 1 ? [] : null;
    return parseLsof(text, port);
  } catch {
    return null;
  }
}

/**
 * lsof's `-F` output: lines with a one-character prefix, grouped by process
 * (`p`/`c`) and then by file (`n`). It is read in order, keeping the current
 * state — an `n` belongs to the last `p` seen.
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
      // `n` can appear more than once for the same process (IPv4 and IPv6):
      // they are two distinct binds and both have to be shown.
      if (!val.endsWith(`:${port}`)) continue;
      out.push({ pid, command, address: val });
    }
  }
  return out;
}
