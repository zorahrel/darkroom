import { useState } from "react";
import { api, collageUrl, type Collage } from "../api";

/**
 * A collage slide inside the post's grid. It is a single slide: it takes one
 * cell like a photo and shows the JPG actually composed (the same file that
 * will end up in the export, not a fake CSS preview), so what you choose is
 * what you publish.
 *
 * The compositions are all full-bleed — no frames, no visible background —
 * because a slide with white borders reads like an album page, not like a
 * photo.
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
  /** Until the grade is known, `graded` holds its default: asking for the
   *  image right away would mean composing it twice (once wrong, once right),
   *  and composing a collage costs seconds, not milliseconds. */
  gradeReady?: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The file is cached on a key of the parameters: changing the composition
  // changes the name by itself, but the browser already has the URL cached —
  // this knocks on it.
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
      // A refusal from the server must not stay in the console: here somebody
      // is clicking and expects to see the image change.
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border-2 border-fuchsia-500/80 bg-black">
      {/* Composing a collage is real work (seconds, not milliseconds): the
          cell says what is happening instead of staying a black hole. No
          `loading="lazy"`: a slide that composes only when you scroll it under
          your eyes always arrives late. */}
      {gradeReady && (
        <img
          src={collageUrl(collage.id, { graded, bust })}
          alt={`collage ${collage.mode}`}
          onLoad={() => setLoaded(true)}
          // `contain`, not `cover`: the slide is 4:5 and the cell is square, so
          // cropping it would hide a fifth of the composition — precisely the
          // thing being judged. Better to see it whole with two dark bands at
          // the sides than to see a piece of it full screen.
          className={
            "h-full w-full object-contain transition-opacity duration-200 " +
            (loaded ? "opacity-100" : "opacity-0")
          }
        />
      )}
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[10px] text-neutral-400">
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
              // A composition that does not hold all the photos would lose one
              // without saying so: it is shown greyed out, with the reason in
              // the tooltip.
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
                        : "cursor-not-allowed border-neutral-800 text-neutral-400")
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
                          : "cursor-not-allowed border-neutral-800 text-neutral-400")
                    }
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-[10px] text-neutral-400">{current?.hint}</span>
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
