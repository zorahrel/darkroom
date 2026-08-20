import { useEffect, useMemo, useRef, useState } from "react";
import { api, pq, type VideoAssets, type VideoCut, type VideoShot } from "../api";

/**
 * L'editor di un progetto video.
 *
 * Due riquadri e basta: il reel montato con sotto la sua linea del tempo, e la
 * griglia dei piani girati. La griglia esiste per una ragione sola — decidere
 * quali piani tengono. E' l'unica decisione della catena che una misura non sa
 * prendere: ne sono state provate due (bilancio tonale, poi area di dettaglio)
 * e tutte e due hanno promosso inquadrature che l'occhio aveva gia' bocciato.
 * Quindi qui si guarda e si clicca, e `scelte.json` e' il contratto col Python.
 */
export default function Video() {
  const [shots, setShots] = useState<VideoShot[]>([]);
  const [cuts, setCuts] = useState<VideoCut[]>([]);
  const [assets, setAssets] = useState<VideoAssets | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [durata, setDurata] = useState(0);
  const [t, setT] = useState(0);
  const [solo, setSolo] = useState<"tutti" | "tenuti" | "scartati">("tutti");
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    api.videoShots().then((r) => setShots(r.shots)).catch(() => {});
    api.videoCuts().then((r) => { setCuts(r.cuts); setBpm(r.bpm); setDurata(r.durata); }).catch(() => {});
    api.videoAssets().then(setAssets).catch(() => {});
  }, []);

  const src = assets?.anteprima ?? assets?.reel ?? null;
  const tenuti = shots.filter((s) => s.kept).length;
  const inScena = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cuts) m.set(c.shot, (m.get(c.shot) ?? 0) + c.dur);
    return m;
  }, [cuts]);

  const vai = (s: number) => {
    if (!video.current) return;
    video.current.currentTime = s;
    video.current.play().catch(() => {});
  };

  const [scrivo, setScrivo] = useState<string | null>(null);
  const [testo, setTesto] = useState("");

  const segnala = async (shot: string) => {
    const t = testo.trim();
    if (!t) { setScrivo(null); return; }
    setScrivo(null); setTesto("");
    try { setShots((await api.videoProblema(shot, t)).shots); } catch { /* niente */ }
  };
  const togli = async (shot: string, i: number) => {
    try { setShots((await api.videoProblema(shot, undefined, i)).shots); } catch { /* niente */ }
  };

  const pickTake = async (shot: string, take: string, kept: boolean) => {
    setShots((prev) => prev.map((s) => s.id === shot
      ? { ...s, takes: s.takes.map((t) => (t.take === take ? { ...t, kept } : t)) } : s));
    try { setShots((await api.videoRipresa(shot, take, kept)).shots); } catch { /* niente */ }
  };

  const pick = async (shot: string, kept: boolean) => {
    setShots((prev) => prev.map((s) => (s.id === shot ? { ...s, kept } : s)));
    try {
      const r = await api.videoPick(shot, kept);
      setShots(r.shots);
    } catch { /* la riga resta come l'utente l'ha messa */ }
  };

  const visibili = shots.filter((s) =>
    solo === "tutti" ? true : solo === "tenuti" ? s.kept : !s.kept);

  const attivo = cuts.find((c) => t >= c.t && t < c.t + c.dur);

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-4 text-neutral-200">
      <div className="flex items-baseline gap-4 mb-3">
        <h1 className="tracking-[0.3em] text-[13px] text-neutral-400">MONTAGGIO</h1>
        <span className="text-[12px] text-neutral-600">
          {cuts.length} tagli · {shots.length} piani girati · {tenuti} tenuti
          {bpm ? ` · ${bpm.toFixed(1)} BPM` : ""} · {durata.toFixed(1)}s
        </span>
      </div>

      <div className="flex gap-5 items-start">
        {/* --- il reel --- */}
        <div className="shrink-0 w-[300px]">
          {src ? (
            <video
              ref={video}
              src={pq(`/api/video/asset/${src}`)}
              controls
              playsInline
              loop
              className="w-full bg-black border border-neutral-800 rounded-sm"
              onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)}
            />
          ) : (
            <div className="w-full aspect-[9/16] bg-black border border-neutral-800 rounded-sm
                            grid place-items-center text-neutral-600 text-xs">
              nessun montaggio ancora
            </div>
          )}
          {attivo && (
            <div className="mt-2 text-[11px] text-neutral-500 tabular-nums">
              {attivo.shot} · {attivo.dur.toFixed(2)}s · {attivo.velocita.toFixed(2)}x
              {attivo.rovescio ? " · rovescio" : ""}{attivo.fermo ? " · fermo" : ""}
            </div>
          )}
        </div>

        {/* --- la linea del tempo: ogni taglio e' un blocco, alto quanto e' duro il suono --- */}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-neutral-600 mb-1">
            linea del tempo — altezza = durezza del suono, clic per saltarci
          </div>
          <div className="relative h-24 bg-neutral-950 border border-neutral-900 rounded-sm overflow-hidden">
            {cuts.map((c, i) => (
              <button
                key={i}
                title={`${c.shot} · ${c.t.toFixed(1)}s · ${c.velocita.toFixed(2)}x`}
                onClick={() => vai(c.t + 0.02)}
                className="absolute bottom-0 border-r border-black/60 hover:brightness-150"
                style={{
                  left: `${(c.t / durata) * 100}%`,
                  width: `${Math.max(0.25, (c.dur / durata) * 100)}%`,
                  height: `${18 + c.durezzaSuono * 82}%`,
                  background: c.rovescio ? "#8a5a3a" : c.fermo ? "#3a3a3a" : "#3f6076",
                }}
              />
            ))}
            {durata > 0 && (
              <div className="absolute top-0 bottom-0 w-px bg-orange-400/90 pointer-events-none"
                   style={{ left: `${(t / durata) * 100}%` }} />
            )}
          </div>
          <div className="mt-1 flex gap-4 text-[10.5px] text-neutral-600">
            <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{background:"#3f6076"}} />taglio</span>
            <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{background:"#8a5a3a"}} />rovescio</span>
            <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{background:"#3a3a3a"}} />fermo immagine</span>
          </div>
        </div>
      </div>

      {/* --- i piani --- */}
      <div className="mt-6 flex items-center gap-3">
        <h2 className="tracking-[0.22em] text-[12px] text-neutral-400">PIANI</h2>
        {(["tutti", "tenuti", "scartati"] as const).map((k) => (
          <button key={k} onClick={() => setSolo(k)}
            className={`text-[11px] px-2 py-0.5 rounded-sm border ${
              solo === k ? "border-neutral-500 text-neutral-200" : "border-neutral-800 text-neutral-600"}`}>
            {k}
          </button>
        ))}
        <span className="text-[11px] text-neutral-600">
          passa sopra per farlo partire · clic su tieni/scarta
        </span>
      </div>

      <div className="mt-3 grid gap-3"
           style={{ gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))" }}>
        {visibili.map((s) => (
          <div key={s.id}
               className={`rounded-sm border ${s.kept ? "border-neutral-800" : "border-neutral-900 opacity-45"}`}>
            <div className="flex">
              {s.takes.map((tk) => (
                <div key={tk.take} className="relative" style={{ width: `${100 / s.takes.length}%` }}>
                  <video
                    src={pq(tk.clip)}
                    poster={pq(tk.poster)}
                    muted loop playsInline preload="none"
                    onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                    onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    className={`w-full bg-black ${tk.kept ? "" : "opacity-25 grayscale"}`}
                  />
                  {/* Il voto sta sulla singola ripresa: due riprese dello stesso
                      piano non valgono uguale, e buttarne una non deve costare
                      il piano intero. */}
                  <button
                    onClick={() => pickTake(s.id, tk.take, !tk.kept)}
                    title={tk.kept ? `ripresa ${tk.take}: in uso` : `ripresa ${tk.take}: scartata`}
                    className={`absolute bottom-1 left-1 text-[9px] leading-none px-1 py-0.5 rounded-sm border
                      ${tk.kept ? "bg-black/70 border-neutral-600 text-neutral-200"
                                : "bg-black/80 border-neutral-800 text-neutral-600 line-through"}`}>
                    {tk.take}
                  </button>
                </div>
              ))}
            </div>
            <div className="px-2 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-neutral-200 truncate">{s.id}</span>
                <span className="text-[10px] text-neutral-600 tabular-nums">
                  {(inScena.get(s.id) ?? 0).toFixed(1)}s
                </span>
              </div>
              <div className="mt-1 h-1 bg-neutral-900">
                <div className="h-full bg-[#9a6a4a]" style={{ width: `${(s.durezza ?? 0) * 100}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-neutral-600 tabular-nums">
                  dur {s.durezza?.toFixed(2) ?? "—"} · mot {s.moto?.toFixed(1) ?? "—"}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setScrivo(scrivo === s.id ? null : s.id); setTesto(""); }}
                    title="segnala un problema"
                    className="text-[10px] px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-500 hover:text-amber-400 hover:border-amber-700">
                    !
                  </button>
                  <button
                    onClick={() => pick(s.id, !s.kept)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${
                      s.kept ? "border-neutral-700 text-neutral-300" : "border-neutral-800 text-neutral-500"}`}>
                    {s.kept ? "tieni" : "scarta"}
                  </button>
                </div>
              </div>
              {scrivo === s.id && (
                <input
                  autoFocus
                  value={testo}
                  onChange={(e) => setTesto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") segnala(s.id);
                    if (e.key === "Escape") setScrivo(null);
                  }}
                  onBlur={() => segnala(s.id)}
                  placeholder="cosa non va — invio per salvare"
                  className="mt-1 w-full bg-neutral-950 border border-amber-900/60 rounded-sm
                             px-1.5 py-1 text-[10.5px] text-neutral-200 outline-none"
                />
              )}
              {s.problemi.map((q, i) => (
                <div key={i} className="mt-1 flex items-start gap-1 text-[10px] leading-tight text-amber-500/80">
                  <button onClick={() => togli(s.id, i)} title="risolto" className="text-neutral-700 hover:text-neutral-400">×</button>
                  <span>{q}</span>
                </div>
              ))}
              {s.perche && <div className="mt-1 text-[10px] text-neutral-600 leading-tight">{s.perche}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
