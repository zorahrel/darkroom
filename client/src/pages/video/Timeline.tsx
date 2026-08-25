import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pq, type VideoAtto, type VideoCut, type VideoMarcatore, type VideoOnda } from "../../api";

/**
 * La linea del tempo.
 *
 * Quattro corsie sulla stessa scala orizzontale — righello, suono, tagli,
 * fotogrammi — piu' una testina che le attraversa tutte. Che condividano la
 * scala non e' un dettaglio grafico: e' l'unico modo di vedere che il taglio a
 * 2:18 cade sul beat e non due fotogrammi dopo.
 *
 * Lo zoom esiste per la stessa ragione. Su due minuti e mezzo in mille pixel un
 * fotogramma e' un ventesimo di pixel: a quella scala "il taglio arriva tardi"
 * non e' una cosa che si possa guardare, solo una che si possa sospettare.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

type Props = {
  cuts: VideoCut[];
  atti: VideoAtto[];
  onda: VideoOnda | null;
  durata: number;
  t: number;
  poster: Map<string, string>;
  scelto: number | null;
  inOut: [number, number] | null;
  setInOut: (v: [number, number] | null) => void;
  apri: (i: number) => void;
  vaiA: (s: number, parti?: boolean) => void;
  gira: boolean;
  marcatori: VideoMarcatore[];
  togliMarcatore: (t: number) => void;
};

export default function Timeline(p: Props) {
  const { cuts, atti, onda, durata, t, poster, scelto, inOut, apri, vaiA, gira, marcatori, togliMarcatore } = p;
  const [zoom, setZoom] = useState(0);          // 0 = tutto in vista
  const scroller = useRef<HTMLDivElement>(null);
  const [larghezzaVista, setLarghezzaVista] = useState(1000);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLarghezzaVista(el.clientWidth));
    ro.observe(el);
    setLarghezzaVista(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const base = durata ? larghezzaVista / durata : 1;   // px al secondo, tutto in vista
  const pps = zoom === 0 ? base : base * Math.pow(2, zoom);
  const larghezza = Math.max(larghezzaVista, durata * pps);
  const x = useCallback((s: number) => s * pps, [pps]);

  /** La vista insegue la testina, ma solo mentre il video corre: se lo
   *  spostasse anche da fermi, ogni clic su un taglio farebbe saltare la
   *  timeline sotto il dito. */
  useEffect(() => {
    const el = scroller.current;
    if (!el || !gira || zoom === 0) return;
    const px = x(t);
    const m = el.clientWidth * 0.15;
    if (px < el.scrollLeft + m || px > el.scrollLeft + el.clientWidth - m) {
      el.scrollLeft = px - el.clientWidth / 2;
    }
  }, [t, gira, zoom, x]);

  const cerca = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    const dove = (cx: number) => vaiA(Math.max(0, Math.min(durata, (cx - box.left) / pps)));
    dove(e.clientX);
    const muovi = (ev: PointerEvent) => dove(ev.clientX);
    const su = () => { window.removeEventListener("pointermove", muovi); window.removeEventListener("pointerup", su); };
    window.addEventListener("pointermove", muovi); window.addEventListener("pointerup", su);
  };

  /** Le tacche del righello si diradano da sole: a scala piena una ogni dieci
   *  secondi, da vicino una al secondo. Senza, o sono illeggibili o sono inutili. */
  const passo = useMemo(() => {
    for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pps >= 55) return s;
    return 60;
  }, [pps]);

  const tacche = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s <= durata; s += passo) out.push(Math.round(s * 100) / 100);
    return out;
  }, [durata, passo]);

  const onde = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = onde.current;
    if (!c || !onda?.picchi.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.min(larghezza, 16000);        // oltre, il canvas smette di allocare
    c.width = W * dpr; c.height = 54 * dpr;
    c.style.width = `${W}px`;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, 54);
    const n = onda.picchi.length;
    g.fillStyle = "#4b6b80";
    for (let i = 0; i < W; i++) {
      const k = Math.floor((i / W) * n);
      const h = (onda.picchi[k] ?? 0) * 50;
      g.fillRect(i, 27 - h / 2, 1, Math.max(1, h));
    }
  }, [onda, larghezza]);

  const B = "px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-500 hover:text-neutral-200";
  return (
    <div>
      <div className="flex items-center gap-2 mb-1 text-[11px]">
        <span className="text-neutral-600">timeline</span>
        <button className={B} onClick={() => setZoom(0)}>tutto</button>
        <button className={B} onClick={() => setZoom((z) => Math.max(0, (z || 1) - 1))}>−</button>
        <button className={B} onClick={() => setZoom((z) => Math.min(7, z + 1))}>+</button>
        <span className="text-neutral-700 tabular-nums w-20">
          {zoom === 0 ? "tutto" : `${Math.pow(2, zoom).toFixed(0)}x`}
        </span>
        <button className={B} title="segna l'inizio del tratto  i" onClick={() => p.setInOut([t, inOut?.[1] ?? durata])}>in</button>
        <button className={B} title="segna la fine  o" onClick={() => p.setInOut([inOut?.[0] ?? 0, t])}>out</button>
        {inOut && (
          <button className={`${B} text-amber-400/80`} onClick={() => p.setInOut(null)}>
            tratto {mmss(inOut[0])}–{mmss(inOut[1])} · togli
          </button>
        )}
        <span className="ml-auto text-neutral-700">
          i · o tratto · l ciclo · m appunto · trascina per cercare · ⌥rotellina zoom
        </span>
      </div>

      <div className="flex border border-neutral-900 rounded-sm bg-neutral-950">
      {/* Cinque corsie senza nome sono cinque righe di grigio. La colonna resta
          ferma mentre il resto scorre: il nome deve essere leggibile anche a
          128x, quando sotto passa un secondo di brano. */}
      <div className="shrink-0 w-[72px] border-r border-neutral-900 text-[9.5px] text-neutral-600 select-none">
        <div className="h-5 border-b border-neutral-900 leading-5 px-1.5">tempo · <span className="text-amber-500/70">◆</span></div>
        <div className="h-4 border-b border-neutral-900 leading-4 px-1.5">atti</div>
        <div className="h-[54px] border-b border-neutral-900 px-1.5 pt-1 leading-tight">
          suono<br /><span className="text-neutral-800">onda + battute</span>
        </div>
        <div className="h-16 border-b border-neutral-900 px-1.5 pt-1 leading-tight">
          tagli<br /><span className="text-neutral-800">altezza = durezza</span>
        </div>
        <div className="h-16 px-1.5 pt-1 leading-tight">
          quadri<br /><span className="text-neutral-800">un piano</span>
        </div>
      </div>
      <div
        ref={scroller}
        className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden"
        onWheel={(e) => {
          if (!e.altKey) return;
          e.preventDefault();
          setZoom((z) => Math.max(0, Math.min(7, (z || 1) + (e.deltaY < 0 ? 1 : -1))));
        }}>
        <div className="relative select-none" style={{ width: larghezza }}>
          {/* righello */}
          <div className="relative h-5 border-b border-neutral-900 cursor-text" onPointerDown={cerca}>
            {marcatori.map((m) => (
              <button key={m.t} title={`${mmss(m.t)} — ${m.nota}  (clic per andarci, ⇧clic per togliere)`}
                      onClick={(e) => { e.stopPropagation(); if (e.shiftKey) togliMarcatore(m.t); else vaiA(m.t, true); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="absolute -top-[1px] z-30 w-[9px] h-[9px] bg-amber-400 rotate-45
                                 hover:bg-amber-200 -ml-[4px]"
                      style={{ left: x(m.t) }} />
            ))}
            {tacche.map((s) => (
              <div key={s} className="absolute top-0 bottom-0 border-l border-neutral-800/70 pl-1
                                      text-[9.5px] text-neutral-600 tabular-nums leading-5"
                   style={{ left: x(s) }}>
                {mmss(s)}
              </div>
            ))}
          </div>

          {/* atti */}
          <div className="relative h-4 border-b border-neutral-900">
            {atti.map((a, i) => (
              <button key={i} onClick={() => vaiA(a.t0, true)}
                      title={`atto ${a.nome} · batt ${a.da}–${a.a}`}
                      className="absolute inset-y-0 border-r border-black/70 bg-neutral-900/80
                                 text-[9.5px] text-neutral-500 hover:text-neutral-200 truncate px-1"
                      style={{ left: x(a.t0), width: Math.max(2, x(a.t1 - a.t0)) }}>
                {a.nome}
              </button>
            ))}
          </div>

          {/* suono: onda, beat, battute */}
          <div className="relative h-[54px] border-b border-neutral-900 cursor-text" onPointerDown={cerca}>
            <canvas ref={onde} className="absolute inset-y-0 left-0 h-[54px] pointer-events-none" />
            {pps > 12 && onda?.beats.map((b, i) => (
              <div key={i} className="absolute inset-y-0 w-px bg-neutral-700/40 pointer-events-none" style={{ left: x(b) }} />
            ))}
            {onda?.battute.map((b, i) => (
              <div key={`m${i}`} className="absolute inset-y-0 w-px bg-neutral-500/50 pointer-events-none" style={{ left: x(b) }} />
            ))}
            {!onda?.pronta && (
              <div className="absolute inset-0 grid place-items-center text-[10.5px] text-neutral-700">
                calcolo la forma d'onda…
              </div>
            )}
          </div>

          {/* tagli: alti quanto e' duro il suono, la riga gialla e' l'immagine */}
          <div className="relative h-16 border-b border-neutral-900 bg-black/40">
            {cuts.map((c, i) => (
              <button key={i} onClick={() => apri(i)}
                      title={`${c.shot} · ${mmss(c.t)} · ${c.dur.toFixed(2)}s · ${c.velocita.toFixed(2)}x`}
                      className={`absolute bottom-0 border-r border-black/60 hover:brightness-150 ${
                        scelto === i ? "outline outline-1 -outline-offset-1 outline-orange-400 z-10" : ""}`}
                      style={{
                        left: x(c.t), width: Math.max(1, x(c.dur)),
                        height: `${18 + c.durezzaSuono * 82}%`,
                        background: c.rovescio ? "#8a5a3a" : "#3f6076",
                      }} />
            ))}
            {cuts.map((c, i) => c.durezzaPiano === null ? null : (
              <div key={`p${i}`} className="absolute h-[2px] bg-[#c9a227]/80 pointer-events-none"
                   style={{ left: x(c.t), width: Math.max(1, x(c.dur)), bottom: `${18 + c.durezzaPiano * 82}%` }} />
            ))}
            {pps > 40 && cuts.map((c, i) => (
              <div key={`n${i}`} className="absolute top-0 text-[9px] text-neutral-300/80 px-1 pointer-events-none truncate"
                   style={{ left: x(c.t), width: Math.max(1, x(c.dur)) }}>
                {c.shot}
              </div>
            ))}
          </div>

          {/* fotogrammi */}
          <div className="relative h-16">
            {cuts.map((c, i) => {
              const src = poster.get(c.shot);
              return (
                <button key={i} onClick={() => apri(i)} title={`${c.shot} · ${mmss(c.t)}`}
                        className={`absolute inset-y-0 border-r border-black/70 bg-cover bg-center ${
                          scelto === i ? "outline outline-1 -outline-offset-1 outline-orange-400 z-10" : "opacity-80 hover:opacity-100"}`}
                        style={{
                          left: x(c.t), width: Math.max(1, x(c.dur)),
                          backgroundImage: src ? `url(${pq(src)})` : undefined,
                          backgroundColor: src ? undefined : "#111",
                        }} />
              );
            })}
          </div>

          {/* il tratto scelto, sopra tutte le corsie */}
          {inOut && (
            <>
              <div className="absolute top-0 bottom-0 bg-black/55 pointer-events-none" style={{ left: 0, width: x(inOut[0]) }} />
              <div className="absolute top-0 bottom-0 bg-black/55 pointer-events-none"
                   style={{ left: x(inOut[1]), width: Math.max(0, larghezza - x(inOut[1])) }} />
              <div className="absolute top-0 bottom-0 border-x border-amber-500/70 pointer-events-none"
                   style={{ left: x(inOut[0]), width: Math.max(1, x(inOut[1] - inOut[0])) }} />
            </>
          )}

          {/* testina */}
          <div className="absolute top-0 bottom-0 w-px bg-orange-400 pointer-events-none z-20" style={{ left: x(t) }}>
            <div className="absolute -top-[3px] -left-[3.5px] w-[8px] h-[8px] bg-orange-400 rotate-45" />
          </div>
        </div>
      </div>
      </div>

      {/* Cosa vuol dire ogni colore, sotto e non a memoria. */}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-600">
        <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: "#3f6076" }} />blocco = un taglio, alto quanto e' duro il suono</span>
        <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: "#c9a227" }} />riga = durezza dell'immagine scelta</span>
        <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: "#8a5a3a" }} />taglio riprodotto al contrario</span>
        <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: "#4b6b80" }} />ampiezza del brano</span>
        <span><i className="inline-block w-px h-3 mr-1 align-middle bg-neutral-500/70" />confine di battuta</span>
        <span><i className="inline-block w-px h-3 mr-1 align-middle bg-orange-400" />dove sei</span>
      </div>
    </div>
  );
}
