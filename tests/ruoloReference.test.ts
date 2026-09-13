import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { refsDir } from "../server/project.ts";

/**
 * A cosa serve una reference: tenere il VISO o imporre un ASPETTO.
 *
 * Sono due lavori opposti sulla stessa immagine. Una reference di identita'
 * allegata come stile fa somigliare tutto a lei; una di stile allegata come
 * identita' cambia la faccia. Finora si distinguevano dal nome del file, cioe'
 * per convenzione fra umani — e «bocca-reale.png» e «occhiali-gascan.jpg» sono
 * plausibili come tutte e due.
 */
const nome = "prova-ruolo.png";
beforeEach(() => {
  mkdirSync(refsDir(), { recursive: true });
  writeFileSync(join(refsDir(), nome), "x");
});

const metti = (file: string, role: unknown) =>
  app.request(`/api/references/${encodeURIComponent(file)}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });

describe("ruolo di una reference", () => {
  test("si dichiara, e l'elenco lo riporta", async () => {
    expect((await metti(nome, "stile")).status).toBe(200);
    const l = (await (await app.request("/api/references")).json()) as {
      references: { file: string; role: string | null }[];
    };
    expect(l.references.find((r) => r.file === nome)?.role).toBe("stile");
  });

  test("si toglie, e torna «non dichiarato» invece di un valore di riposo", async () => {
    await metti(nome, "identita");
    await metti(nome, null);
    const l = (await (await app.request("/api/references")).json()) as {
      references: { file: string; role: string | null }[];
    };
    // `null` non e' «nessun ruolo scelto per difetto»: e' l'informazione che
    // nessuno l'ha ancora detto, e va distinta da una scelta fatta.
    expect(l.references.find((r) => r.file === nome)?.role).toBeNull();
  });

  test("un ruolo inventato viene rifiutato", async () => {
    const r = await metti(nome, "boh");
    expect(r.status).toBe(400);
  });

  test("una reference che non esiste non si annota", async () => {
    expect((await metti("mai-vista.png", "stile")).status).toBe(404);
  });

  test("un nome che e' un percorso non viene nemmeno guardato", async () => {
    // Non e' paranoia astratta: il caricamento gia' difende da questo, e
    // un'annotazione che accettasse un percorso aprirebbe la stessa porta da
    // un'altra parte.
    const r = await metti("../../fuori.png", "stile");
    expect(r.status).toBe(400);
  });
});
