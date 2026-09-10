/**
 * Le cartelle trascinate dentro la finestra.
 *
 * Il guscio gira il trascinamento del Finder alla pagina come un evento del documento
 * (`app/src/main.rs`), con i percorsi veri sul disco. Nel browser quell'evento non
 * arriva mai, e non è una dimenticanza: una pagina web riceve il *contenuto* di ciò
 * che le lasci sopra, non il posto da cui viene, e Darkroom lavora indirizzando le
 * fotografie invece di copiarle. Il trascinamento è quindi una cosa che sa fare
 * l'applicazione, non la scheda del browser.
 */

export type FaseTrascinamento = "entra" | "esce" | "lascia";

export type Trascinamento = {
  fase: FaseTrascinamento;
  percorsi: string[];
};

export const EVENTO_TRASCINAMENTO = "darkroom:trascinamento";

/**
 * Cosa fare con quello che è stato lasciato.
 *
 * Dentro un progetto le cartelle diventano sue sorgenti; fuori diventano progetti
 * nuovi. È la stessa domanda a cui risponde il posto in cui ti trovi, quindi non
 * gliela si rifà: chi lascia una cartella sulla pagina dei progetti sta dicendo
 * «questo è un progetto», chi la lascia dentro un progetto sta dicendo «queste sono
 * le sue fotografie».
 */
export type Destinazione =
  | { tipo: "progetto"; pid: string }
  | { tipo: "elenco" };

export function destinazionePer(percorsoPagina: string): Destinazione {
  const m = /^\/p\/([^/]+)/.exec(percorsoPagina);
  return m ? { tipo: "progetto", pid: decodeURIComponent(m[1]!) } : { tipo: "elenco" };
}

/** Il nome che prende un progetto nato da una cartella: quello della cartella. */
export function nomeDaPercorso(percorso: string): string {
  const pulito = percorso.replace(/\/+$/, "");
  const ultimo = pulito.slice(pulito.lastIndexOf("/") + 1);
  return ultimo || pulito || "senza nome";
}

/**
 * Legge il dettaglio di un evento senza fidarsene.
 *
 * Arriva da `eval` nel guscio: è nostro, ma passa per una stringa, e una stringa che
 * si assume ben formata è il modo in cui un errore di battitura diventa una schermata
 * bianca invece di un evento ignorato.
 */
export function leggiTrascinamento(dettaglio: unknown): Trascinamento | null {
  if (!dettaglio || typeof dettaglio !== "object") return null;
  const d = dettaglio as { fase?: unknown; percorsi?: unknown };
  if (d.fase !== "entra" && d.fase !== "esce" && d.fase !== "lascia") return null;
  const percorsi = Array.isArray(d.percorsi)
    ? d.percorsi.filter((p): p is string => typeof p === "string" && p.startsWith("/"))
    : [];
  return { fase: d.fase, percorsi };
}
