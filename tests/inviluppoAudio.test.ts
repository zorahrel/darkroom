import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inviluppoAudio } from "../server/girato.ts";

/**
 * L'andamento del suono di una clip.
 *
 * Risponde alla domanda che il fotogramma non risponde: DOVE succede qualcosa.
 * Su una fila di riprese il punto in cui parla qualcuno o cade un oggetto si
 * vede nell'audio prima che nell'immagine, e senza questa striscia bisognava
 * riprodurre ogni clip per intero per trovarlo.
 *
 * Le clip di prova sono generate da ffmpeg: una con un suono che comincia a
 * meta', una senza traccia audio. Servono tutte e due perche' i due casi si
 * devono distinguere — una clip muta non e' una clip rotta.
 */
const cartella = mkdtempSync(join(tmpdir(), "girato-"));
const conAudio = join(cartella, "con-audio.mp4");
const muta = join(cartella, "muta.mp4");

/** Le clip si generano qui e non si portano dietro: un file di prova nel repo
 *  invecchia e nessuno lo rigenera, e uno in una cartella di sessione fa saltare
 *  la prova su ogni altra macchina — cioe' la fa passare senza provare niente. */
async function ffmpeg(...argv: string[]): Promise<boolean> {
  const p = Bun.spawn({ cmd: ["ffmpeg", "-v", "error", "-y", ...argv], stdout: "ignore", stderr: "ignore" });
  return (await p.exited) === 0;
}

let pronte = false;
beforeAll(async () => {
  // Un tono che comincia a meta': e' cio' che rende verificabile «il suono si
  // vede dove c'e'».
  pronte =
    (await ffmpeg(
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-f", "lavfi", "-i", "color=c=black:s=64x64:d=3",
      "-filter_complex", "[0:a]adelay=1500|1500,apad=whole_dur=3[a]",
      "-map", "1:v", "-map", "[a]", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", conAudio,
    )) &&
    (await ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", muta));
  if (!pronte) throw new Error("ffmpeg non ha prodotto le clip di prova: senza, questa prova non proverebbe niente");
});

describe("inviluppo audio", () =>  {
  test("il suono si vede dove c'e', e non dove non c'e'", async () => {
    const v = (await inviluppoAudio(conAudio, 60))!;
    expect(v).toHaveLength(60);
    // Il tono comincia a meta' della clip: la prima meta' deve essere
    // nettamente piu' silenziosa della seconda. E' l'unica cosa che rende la
    // striscia utile — se fosse piatta, tanto varrebbe non disegnarla.
    const media = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(media(v.slice(0, 25))).toBeLessThan(media(v.slice(35)) / 3);
  });

  test("i valori stanno fra zero e uno", async () => {
    const v = (await inviluppoAudio(conAudio, 40))!;
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
    // Normalizzato sul proprio massimo: fra due clip conta DOVE succede
    // qualcosa, non quale delle due e' registrata piu' forte.
    expect(Math.max(...v)).toBeCloseTo(1, 5);
  });

  test("una clip senza traccia audio torna «niente da disegnare», non zero", async () => {
    // La differenza conta: una riga piatta si legge come un guasto, e in questo
    // progetto una clip muta e' normale (molte macchine fotografiche in video
    // non registrano audio).
    expect(await inviluppoAudio(muta, 20)).toBeNull();
  });
});
