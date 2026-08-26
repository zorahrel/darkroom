import { useEffect, useId, useRef, useState } from "react";

/**
 * I pezzi di interfaccia dell'editor.
 *
 * `<select>` e `<input>` nativi portano dentro la scocca del sistema operativo:
 * un menu a tendina disegnato da macOS, un anello di fuoco azzurro, un carattere
 * che non è quello della pagina. In mezzo a una timeline scura stonano, e
 * soprattutto non si possono far comportare come serve — un menu nativo non sa
 * mostrare un provino accanto alla voce, né chiudersi con esc dove serve.
 *
 * Quindi si disegnano. Ma disegnarli vuol dire rifare anche ciò che il nativo
 * dava gratis, ed è la parte che di solito si scorda: tastiera (frecce, invio,
 * esc, Home/Fine), chiusura al clic fuori, ruolo e stato per chi legge lo
 * schermo, e il fuoco che torna dove stava.
 */

/** Un menu a tendina. Il valore è una stringa; le voci possono avere un'etichetta
 *  diversa dal valore e una nota a destra. */
export function Scegli<T extends string>({
  valore, voci, onCambia, larghezza = 120, titolo,
}: {
  valore: T;
  voci: { v: T; testo: string; nota?: string }[];
  onCambia: (v: T) => void;
  larghezza?: number;
  titolo?: string;
}) {
  const [aperto, setAperto] = useState(false);
  const [evidenziato, setEvidenziato] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const scelta = voci.find((x) => x.v === valore);

  useEffect(() => {
    if (!aperto) return;
    setEvidenziato(Math.max(0, voci.findIndex((x) => x.v === valore)));
    const fuori = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setAperto(false);
    };
    window.addEventListener("pointerdown", fuori);
    return () => window.removeEventListener("pointerdown", fuori);
  }, [aperto, voci, valore]);

  const tasti = (e: React.KeyboardEvent) => {
    if (!aperto) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setAperto(true); }
      return;
    }
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); setAperto(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setEvidenziato((i) => Math.min(voci.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setEvidenziato((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setEvidenziato(0); }
    else if (e.key === "End") { e.preventDefault(); setEvidenziato(voci.length - 1); }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const v = voci[evidenziato];
      if (v) { onCambia(v.v); setAperto(false); }
    }
  };

  return (
    <div ref={box} className="relative" style={{ width: larghezza }}>
      <button
        type="button"
        title={titolo}
        aria-haspopup="listbox"
        aria-expanded={aperto}
        onClick={() => setAperto((a) => !a)}
        onKeyDown={tasti}
        className="w-full flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-neutral-700
                   bg-neutral-950 text-[10.5px] text-neutral-200 text-left
                   hover:border-neutral-500 focus:outline-none focus:border-neutral-300">
        <span className="truncate flex-1">{scelta?.testo ?? valore}</span>
        <span className="text-neutral-400 text-[8px] leading-none">▾</span>
      </button>
      {aperto && (
        <ul role="listbox" id={id}
            className="absolute z-50 mt-0.5 w-full max-h-[46vh] overflow-y-auto bg-neutral-950
                       border border-neutral-700 rounded-sm shadow-2xl py-0.5">
          {voci.map((x, i) => (
            <li key={x.v} role="option" aria-selected={x.v === valore}>
              <button
                type="button"
                onPointerEnter={() => setEvidenziato(i)}
                onClick={() => { onCambia(x.v); setAperto(false); }}
                className={`w-full flex items-baseline gap-2 px-1.5 py-1 text-left text-[10.5px]
                            ${i === evidenziato ? "bg-neutral-800 text-neutral-100" : "text-neutral-300"}`}>
                <span className="truncate flex-1">{x.testo}</span>
                {x.nota && <span className="text-neutral-400 tabular-nums shrink-0">{x.nota}</span>}
                {x.v === valore && <span className="text-emerald-400 shrink-0">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Un campo di testo senza la scocca del sistema. `alt` lo fa alto quanto una
 *  riga di ricerca, `onInvio`/`onEsc` sono i due tasti che in un editor contano. */
export function Campo({
  valore, onCambia, segnaposto, onInvio, onEsc, autoFuoco, className = "",
}: {
  valore: string;
  onCambia: (v: string) => void;
  segnaposto?: string;
  onInvio?: () => void;
  onEsc?: () => void;
  autoFuoco?: boolean;
  className?: string;
}) {
  return (
    <input
      autoFocus={autoFuoco}
      value={valore}
      onChange={(e) => onCambia(e.target.value)}
      placeholder={segnaposto}
      onKeyDown={(e) => {
        // La pagina ascolta lettere singole (spazio, m, z…): mentre si scrive,
        // quelle sono testo, non comandi.
        e.stopPropagation();
        if (e.key === "Enter") onInvio?.();
        if (e.key === "Escape") onEsc?.();
      }}
      className={`appearance-none bg-neutral-950 border border-neutral-700 rounded-sm px-1.5 py-1
                  text-neutral-100 placeholder:text-neutral-500 outline-none
                  focus:border-neutral-300 ${className}`}
    />
  );
}

/** Un bottone della barra degli strumenti: tre pesi, una forma sola. */
export function Bott({
  children, onClick, attivo, peso = "normale", titolo, disabilitato, className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  attivo?: boolean;
  peso?: "normale" | "primario" | "pericolo";
  titolo?: string;
  disabilitato?: boolean;
  className?: string;
}) {
  const stile =
    disabilitato ? "border-neutral-800 text-neutral-500 cursor-not-allowed"
    : peso === "primario" ? "border-neutral-400 text-neutral-100 hover:bg-neutral-800"
    : peso === "pericolo" ? "border-rose-800 text-rose-300 hover:bg-rose-950/50"
    : attivo ? "border-neutral-400 text-neutral-100"
    : "border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500";
  return (
    <button type="button" title={titolo} disabled={disabilitato} onClick={onClick}
            className={`px-1.5 py-0.5 rounded-sm border text-[10.5px] ${stile} ${className}`}>
      {children}
    </button>
  );
}

/** Un'area di testo, stesso trattamento del campo: niente scocca di sistema e
 *  i tasti della pagina non le rubano le lettere mentre si scrive. */
export function Area({
  valore, onCambia, segnaposto, onEsc, onInvia, autoFuoco, className = "",
}: {
  valore: string;
  onCambia: (v: string) => void;
  segnaposto?: string;
  onEsc?: () => void;
  /** ⌘invio: mandare a capo dev'essere possibile, quindi il solo invio no. */
  onInvia?: () => void;
  autoFuoco?: boolean;
  className?: string;
}) {
  return (
    <textarea
      autoFocus={autoFuoco}
      value={valore}
      onChange={(e) => onCambia(e.target.value)}
      placeholder={segnaposto}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onEsc?.();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onInvia?.();
      }}
      className={`appearance-none w-full bg-neutral-950 border border-neutral-700 rounded-sm p-2
                  text-neutral-100 placeholder:text-neutral-500 outline-none resize-none
                  focus:border-neutral-300 ${className}`}
    />
  );
}

/** Un numero con i suoi passi: le frecce lo cambiano, e non compare la doppia
 *  freccina del sistema che nessuno riesce mai a centrare. */
export function Numero({
  valore, onCambia, min = 1, max = 4096, passo = 1, larghezza = 62, titolo,
}: {
  valore: number; onCambia: (v: number) => void;
  min?: number; max?: number; passo?: number; larghezza?: number; titolo?: string;
}) {
  const limita = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center rounded-sm border border-neutral-700 bg-neutral-950"
         style={{ width: larghezza }} title={titolo}>
      <input
        value={valore}
        onChange={(e) => { const n = Number(e.target.value.replace(/[^0-9.]/g, "")); if (Number.isFinite(n)) onCambia(n); }}
        onBlur={() => onCambia(limita(valore))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowUp") { e.preventDefault(); onCambia(limita(valore + passo)); }
          if (e.key === "ArrowDown") { e.preventDefault(); onCambia(limita(valore - passo)); }
        }}
        className="appearance-none w-full bg-transparent px-1.5 py-0.5 text-[10.5px] text-neutral-100
                   tabular-nums outline-none"
      />
      <div className="flex flex-col border-l border-neutral-800">
        <button type="button" onClick={() => onCambia(limita(valore + passo))}
                className="px-1 text-[7px] leading-[9px] text-neutral-400 hover:text-neutral-100">▲</button>
        <button type="button" onClick={() => onCambia(limita(valore - passo))}
                className="px-1 text-[7px] leading-[9px] text-neutral-400 hover:text-neutral-100">▼</button>
      </div>
    </div>
  );
}
