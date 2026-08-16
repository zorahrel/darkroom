import { useState } from "react";
import { api, collageUrl, type Collage } from "../api";

/**
 * Una slide di collage dentro la griglia del post. È una slide sola: occupa una
 * cella come una foto e mostra il JPG realmente composto (lo stesso file che
 * finirà nell'export, non un'anteprima finta in CSS), così quel che scegli è
 * quel che pubblichi.
 *
 * Le composizioni sono tutte a pieno formato — niente cornici, niente fondo a
 * vista — perché una slide con i bordi bianchi legge come una pagina d'album,
 * non come una foto.
 */

const MODES: { id: Collage["mode"]; label: string; cap: number; hint: string }[] = [
  { id: "hero", label: "Principale", cap: 5, hint: "una grande sopra, le altre in striscia" },
  { id: "mosaic", label: "Mosaico", cap: 4, hint: "una grande a sinistra, le altre in colonna" },
  { id: "grid", label: "Griglia", cap: 9, hint: "riquadri uguali, a contatto" },
  { id: "stack", label: "Sovrapposte", cap: 4, hint: "una piena, le altre appoggiate sopra" },
  { id: "split", label: "Diviso", cap: 2, hint: "due foto, taglio netto" },
];

export default function CollageCard({
  collage,
  slot,
  graded,
  gradeReady = true,
  onChanged,
}: {
  collage: Collage;
  slot: number;
  graded: boolean;
  /** Finché il grade non è noto, `graded` vale il suo default: chiedere subito
   *  l'immagine significherebbe comporla due volte (una sbagliata, una giusta),
   *  e comporre un collage costa secondi, non millisecondi. */
  gradeReady?: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Il file è cache su chiave dei parametri: cambiando composizione il nome
  // cambia da solo, ma il browser ha già in cache l'URL — questo lo bussa.
  const [bust, setBust] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const n = collage.photo_ids.length;
  const current = MODES.find((m) => m.id === collage.mode);

  async function patch(p: Partial<Pick<Collage, "mode" | "layout">>) {
    setBusy(true);
    try {
      await api.updateCollage(collage.id, p);
      setLoaded(false);
      setBust(Date.now());
      onChanged();
    } catch (e) {
      // Un rifiuto del server non deve restare in console: qui si sta
      // cliccando e ci si aspetta di vedere l'immagine cambiare.
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border-2 border-fuchsia-500/80 bg-black">
      {/* Comporre un collage è un lavoro vero (secondi, non millisecondi): la
          cella dice cosa sta succedendo invece di restare un buco nero. Niente
          `loading="lazy"`: una slide che si compone solo quando la scrolli
          sotto gli occhi arriva sempre in ritardo. */}
      {gradeReady && (
        <img
          src={collageUrl(collage.id, { graded, bust })}
          alt={`collage ${collage.mode}`}
          onLoad={() => setLoaded(true)}
          // `contain`, non `cover`: la slide è 4:5 e la cella è quadrata, quindi
          // ritagliarla nasconderebbe un quinto della composizione — proprio la
          // cosa che si sta cercando di giudicare. Meglio vederla intera con due
          // bande scure ai lati che vederne un pezzo a schermo pieno.
          className={
            "h-full w-full object-contain transition-opacity duration-200 " +
            (loaded ? "opacity-100" : "opacity-0")
          }
        />
      )}
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[10px] text-neutral-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-fuchsia-700 border-t-transparent" />
          compongo…
        </div>
      )}

      <span className="pointer-events-none absolute left-1 top-1 z-20 rounded bg-fuchsia-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {current?.label ?? collage.mode} · {n}
      </span>
      <span className="pointer-events-none absolute bottom-1 left-1 z-20 min-w-[1.25rem] rounded bg-black/70 px-1 text-center text-[10px] font-semibold tabular-nums text-white">
        {slot + 1}
      </span>

      <button
        onClick={() => setOpen((v) => !v)}
        className="absolute right-1 top-1 z-20 rounded bg-black/60 px-2 py-0.5 text-[10px] text-neutral-200 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
      >
        {open ? "chiudi" : "modifica"}
      </button>

      {open && (
        <div className="absolute inset-x-0 bottom-0 z-30 space-y-1.5 bg-black/85 p-2 backdrop-blur">
          <div className="flex flex-wrap items-center gap-1">
            {MODES.map((m) => {
              // Una composizione che non tiene tutte le foto ne perderebbe una
              // senza dirlo: si mostra spenta, col motivo nel tooltip.
              const fits = m.cap >= n;
              return (
                <button
                  key={m.id}
                  disabled={busy || !fits}
                  title={fits ? m.hint : `«${m.label}» tiene ${m.cap} foto, qui ce ne sono ${n}`}
                  onClick={() => patch({ mode: m.id })}
                  className={
                    "rounded border px-1.5 py-0.5 text-[10px] " +
                    (collage.mode === m.id
                      ? "border-fuchsia-500 bg-fuchsia-600 text-white"
                      : fits
                        ? "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                        : "cursor-not-allowed border-neutral-800 text-neutral-600")
                  }
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {collage.mode === "grid" && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="w-10 text-[10px] text-neutral-400">griglia</span>
              {["1x2", "2x1", "2x2", "3x1", "1x3", "3x2", "3x3"].map((l) => {
                const cells = Number(l[0]) * Number(l[2]);
                const fits = cells >= n;
                return (
                  <button
                    key={l}
                    disabled={busy || !fits}
                    title={fits ? l : `${l} tiene ${cells} foto, qui ce ne sono ${n}`}
                    onClick={() => patch({ layout: l })}
                    className={
                      "rounded border px-1.5 py-0.5 text-[10px] " +
                      (collage.layout === l
                        ? "border-fuchsia-500 bg-fuchsia-600 text-white"
                        : fits
                          ? "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                          : "cursor-not-allowed border-neutral-800 text-neutral-600")
                    }
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-[10px] text-neutral-500">{current?.hint}</span>
            <button
              disabled={busy}
              onClick={async () => {
                if (!confirm("Sciogliere il collage? Le foto tornano slide singole.")) return;
                setBusy(true);
                try {
                  await api.deleteCollage(collage.id);
                  onChanged();
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded border border-red-900 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-950/60"
            >
              sciogli
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
