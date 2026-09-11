import { describe, expect, test } from "bun:test";
import { erroreDiRete } from "../server/higgsfield.ts";

/**
 * Quali errori si possono ritentare, e quali no.
 *
 * La distinzione vale crediti veri: una generazione Higgsfield e' pagata quando
 * parte, e se la connessione cade mentre ne chiediamo lo stato buttare tutto vuol
 * dire aver pagato per niente (successo davvero: due su tre in una serie di
 * ventuno). Ma allargare troppo la rete e' peggio del problema: ritentare un «no»
 * del servizio -- contenuto rifiutato, credito finito -- vuol dire insistere per
 * cinque minuti su una risposta che non cambiera'.
 */
describe("errore di rete", () => {
  test("la connessione caduta si puo' ritentare", () => {
    for (const m of [
      "The socket connection was closed unexpectedly.",
      "fetch failed",
      "read ECONNRESET",
      "connect ETIMEDOUT 1.2.3.4:443",
      "terminated",
    ]) {
      expect(erroreDiRete(new Error(m)), m).toBe(true);
    }
  });

  test("una risposta di rifiuto no: ritentarla e' solo tempo perso", () => {
    for (const m of [
      "generazione nsfw",
      "generazione bloccata (ip_detected): contenuto coperto da copyright",
      "MCP generate_image 402: not enough credits",
      "job completed ma nessun rawUrl",
      "MCP job_status 400: unknown job",
    ]) {
      expect(erroreDiRete(new Error(m)), m).toBe(false);
    }
  });
});
