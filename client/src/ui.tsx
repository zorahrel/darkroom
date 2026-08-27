import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * I pezzi di interfaccia dell'app.
 *
 * Due ragioni per averli in un posto solo.
 *
 * La prima è la scocca del sistema: `<select>` e `<input>` nativi portano
 * dentro un menu disegnato da macOS, un anello di fuoco azzurro e un carattere
 * che non è quello della pagina. Disegnarli vuol dire però rifare anche ciò
 * che il nativo dava gratis, ed è la parte che di solito si scorda: tastiera
 * (frecce, invio, esc, Home/Fine), chiusura al clic fuori, ruolo e stato per
 * chi legge lo schermo, e il fuoco che torna dove stava.
 *
 * La seconda è la gerarchia. Un bottone dice, prima ancora di essere letto,
 * quanto conta: se ogni azione si disegna da sé, "apri" e "cancella per
 * sempre" finiscono con lo stesso peso, e chi guarda deve leggere per sapere
 * quale delle due gli rovina la giornata. Qui i pesi sono quattro e sono
 * dichiarati:
 *
 *   primario   l'azione per cui quella vista esiste. Piena. Una per vista.
 *   normale    un'azione ordinaria. Contornata.
 *   quieto     di servizio: c'è, ma non chiede attenzione. Solo testo.
 *   pericolo   distrugge qualcosa. **Non si mostra mai per prima**: è la
 *              seconda faccia di `<Conferma>`, non un bottone che si mette
 *              in giro.
 */

// ---- misure ---------------------------------------------------------------
// Tre taglie, non quattordici. `s` per le barre dense di un editor, `m` per i
// pannelli, `l` per le azioni di pagina.
const TAGLIA = {
  s: "text-[10.5px] px-1.5 py-0.5 rounded-sm gap-1",
  m: "text-[12px] px-2 py-1 rounded gap-1.5",
  l: "text-[13px] px-3 py-1.5 rounded gap-2",
} as const;

export type Taglia = keyof typeof TAGLIA;
export type Peso = "primario" | "normale" | "quieto" | "pericolo";

const PESO: Record<Peso, string> = {
  primario: "border-transparent bg-neutral-100 text-neutral-900 hover:bg-white font-medium",
  normale: "border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:text-neutral-100",
  quieto: "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/70",
  pericolo: "border-rose-800 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50",
};

export function Bott({
  children, onClick, attivo, peso = "normale", taglia = "m",
  titolo, disabilitato, className = "", tipo = "button",
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  /** Stato acceso di un interruttore: si vede senza doverlo leggere. */
  attivo?: boolean;
  peso?: Peso;
  taglia?: Taglia;
  titolo?: string;
  disabilitato?: boolean;
  className?: string;
  tipo?: "button" | "submit";
}) {
  const stile = disabilitato
    ? "border-neutral-800 text-neutral-400/50 cursor-not-allowed"
    : attivo
      ? "border-neutral-400 bg-neutral-800 text-neutral-100"
      : PESO[peso];
  return (
    <button
      type={tipo}
      title={titolo}
      disabled={disabilitato}
      aria-pressed={attivo}
      onClick={onClick}
      className={`inline-flex items-center justify-center border whitespace-nowrap
                  transition-colors focus-visible:outline focus-visible:outline-1
                  focus-visible:outline-offset-1 focus-visible:outline-neutral-300
                  ${TAGLIA[taglia]} ${stile} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Un'azione che distrugge qualcosa.
 *
 * Il primo tocco non fa niente: apre la domanda. Il bottone rosso esiste solo
 * dentro la domanda, e accanto ha sempre la via d'uscita. Così la cosa
 * pericolosa non sta ferma sullo schermo con l'aria di essere cliccabile per
 * sbaglio, e chi la vede la vede insieme a cosa succede davvero.
 */
export function Conferma({
  children, domanda, conferma, onConferma, taglia = "m", titolo, className = "",
}: {
  /** Il richiamo, sempre quieto. */
  children: React.ReactNode;
  /** Che cosa succede, detto per intero. */
  domanda: string;
  /** Il testo del bottone rosso: un verbo, non "ok". */
  conferma: string;
  onConferma: () => void;
  taglia?: Taglia;
  titolo?: string;
  className?: string;
}) {
  const [chiesto, setChiesto] = useState(false);
  useEffect(() => {
    if (!chiesto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setChiesto(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [chiesto]);

  if (!chiesto) {
    return (
      <Bott peso="quieto" taglia={taglia} titolo={titolo} className={className}
            onClick={() => setChiesto(true)}>
        {children}
      </Bott>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-neutral-300">{domanda}</span>
      <Bott peso="pericolo" taglia={taglia} onClick={() => { setChiesto(false); onConferma(); }}>
        {conferma}
      </Bott>
      <Bott peso="quieto" taglia={taglia} onClick={() => setChiesto(false)}>lascia stare</Bott>
    </span>
  );
}

/** Un'etichetta di stato. Non si clicca e non deve sembrare che si possa. */
/**
 * La scorciatoia da tastiera, stampata DENTRO il tasto che esegue.
 *
 * Prima stava in una legenda a fianco («← scarta · → tieni · ↑ annota»). Una
 * legenda si legge una volta e poi diventa arredamento: sta sempre nello stesso
 * posto, non cambia mai, e l'occhio smette di vederla proprio quando servirebbe
 * — cioe' al momento di esitare su un tasto. Sul tasto invece la si guarda ogni
 * volta che ci si guarda il tasto, e chi la impara smette da solo di usarlo.
 */
export function Scorciatoia({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="px-1 py-px rounded-[3px] border border-current/30 bg-current/10
                 text-[9.5px] leading-none font-medium opacity-70 tabular-nums"
    >
      {children}
    </kbd>
  );
}

/** Un tasto d'azione con la sua scorciatoia stampata sopra. */
export function TastoGiudizio({
  onClick,
  tasto,
  className = "",
  children,
}: {
  onClick: () => void;
  tasto: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-sm border text-[13px] inline-flex items-center gap-2 ${className}`}
    >
      {children}
      <Scorciatoia>{tasto}</Scorciatoia>
    </button>
  );
}

export function Targa({
  children, tono = "neutro", titolo, className = "",
}: {
  children: React.ReactNode;
  tono?: "neutro" | "buono" | "attesa" | "male" | "info";
  titolo?: string;
  className?: string;
}) {
  const t = {
    neutro: "border-neutral-700 text-neutral-300",
    buono: "border-emerald-800 text-emerald-300 bg-emerald-950/40",
    attesa: "border-amber-800 text-amber-200 bg-amber-950/40",
    male: "border-rose-900 text-rose-200 bg-rose-950/40",
    info: "border-sky-800 text-sky-200 bg-sky-950/40",
  }[tono];
  return (
    <span title={titolo}
          className={`inline-flex items-center gap-1 border rounded-sm px-1.5 py-[1px]
                      text-[10.5px] whitespace-nowrap ${t} ${className}`}>
      {children}
    </span>
  );
}

/** Un interruttore: acceso/spento si legge dalla forma, non dalla parola. */
export function Interruttore({
  acceso, onCambia, acceso_testo, spento_testo, titolo,
}: {
  acceso: boolean;
  onCambia: (v: boolean) => void;
  acceso_testo: string;
  spento_testo: string;
  titolo?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={acceso} title={titolo}
            onClick={() => onCambia(!acceso)}
            className="inline-flex items-center gap-1.5 text-[11px] group">
      <span className={`w-6 h-3.5 rounded-full border transition-colors relative shrink-0 ${
        acceso ? "bg-emerald-800/70 border-emerald-600" : "bg-neutral-800 border-neutral-600"}`}>
        <span className={`absolute top-[1px] w-[10px] h-[10px] rounded-full transition-all ${
          acceso ? "left-[12px] bg-emerald-300" : "left-[1px] bg-neutral-400"}`} />
      </span>
      <span className={acceso ? "text-neutral-200" : "text-neutral-400"}>
        {acceso ? acceso_testo : spento_testo}
      </span>
    </button>
  );
}

/** L'intestazione di una pagina: titolo e, sotto, cosa ci si fa. */
export function Testata({
  titolo, sotto, children,
}: { titolo: string; sotto?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 flex-wrap">
      <div className="min-w-0 space-y-0.5">
        <h1 className="text-[17px] font-semibold tracking-tight leading-tight">{titolo}</h1>
        {sotto && <p className="text-[12px] text-neutral-400 leading-snug">{sotto}</p>}
      </div>
      {children && <div className="ml-auto flex items-center gap-1.5">{children}</div>}
    </div>
  );
}

// ---- campi ----------------------------------------------------------------

/** Un menu a tendina. Il valore è una stringa; le voci possono avere
 *  un'etichetta diversa dal valore e una nota a destra. */
export function Scegli<T extends string>({
  valore, voci, onCambia, larghezza = 120, titolo, taglia = "s",
}: {
  valore: T;
  /** `gruppo` mette una riga di titolo prima della voce: serve quando l'elenco
   *  è lungo e diviso per famiglia (le LUT, per dire). */
  voci: { v: T; testo: string; nota?: string; gruppo?: string }[];
  onCambia: (v: T) => void;
  larghezza?: number;
  titolo?: string;
  taglia?: Taglia;
}) {
  const [aperto, setAperto] = useState(false);
  const [evidenziato, setEvidenziato] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const scelta = voci.find((x) => x.v === valore);
  const t = taglia === "s" ? "text-[10.5px] px-1.5 py-0.5" : "text-[12px] px-2 py-1";

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
        type="button" title={titolo} aria-haspopup="listbox" aria-expanded={aperto}
        onClick={() => setAperto((a) => !a)} onKeyDown={tasti}
        className={`w-full flex items-center gap-1 rounded-sm border border-neutral-700
                    bg-neutral-950 text-neutral-200 text-left ${t}
                    hover:border-neutral-500 focus:outline-none focus:border-neutral-300`}>
        <span className="truncate flex-1">{scelta?.testo ?? valore}</span>
        <span className="text-neutral-400 text-[8px] leading-none">▾</span>
      </button>
      {aperto && (
        <ul role="listbox" id={id}
            className="absolute z-50 mt-0.5 w-full max-h-[46vh] overflow-y-auto bg-neutral-950
                       border border-neutral-700 rounded-sm shadow-2xl py-0.5">
          {voci.map((x, i) => (
            <li key={x.v} role="option" aria-selected={x.v === valore}>
              {x.gruppo && x.gruppo !== voci[i - 1]?.gruppo && (
                <div className="px-1.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
                  {x.gruppo}
                </div>
              )}
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

/** Un campo di testo senza la scocca del sistema. `onInvio`/`onEsc` sono i due
 *  tasti che in un editor contano. */
export function Campo({
  valore, onCambia, segnaposto, onInvio, onEsc, autoFuoco, taglia = "s", className = "",
}: {
  valore: string;
  onCambia: (v: string) => void;
  segnaposto?: string;
  onInvio?: () => void;
  onEsc?: () => void;
  autoFuoco?: boolean;
  taglia?: Taglia;
  className?: string;
}) {
  const t = taglia === "s" ? "text-[10.5px] px-1.5 py-1" : "text-[12px] px-2 py-1.5";
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
      className={`appearance-none bg-neutral-950 border border-neutral-700 rounded-sm
                  text-neutral-100 placeholder:text-neutral-400 outline-none
                  focus:border-neutral-300 ${t} ${className}`}
    />
  );
}

/** Un'area di testo, stesso trattamento del campo. */
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
                  text-neutral-100 placeholder:text-neutral-400 outline-none resize-none
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

/**
 * Una casella da spuntare.
 *
 * Quella nativa su macOS è azzurra, quadrata e col suo bordo di sistema: in una
 * riga scura è l'unico pezzo che viene da un altro programma. Questa ha lo
 * stesso comportamento — spazio la cambia, il fuoco si vede, l'etichetta è
 * cliccabile — e la stessa grafica del resto.
 */
export function Spunta({
  segnata, onCambia, children, titolo, disabilitata,
}: {
  segnata: boolean;
  onCambia: (v: boolean) => void;
  children?: React.ReactNode;
  titolo?: string;
  disabilitata?: boolean;
}) {
  return (
    <button
      type="button" role="checkbox" aria-checked={segnata} title={titolo} disabled={disabilitata}
      onClick={() => onCambia(!segnata)}
      className={`inline-flex items-center gap-1.5 text-left text-[11px] group
                  focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2
                  focus-visible:outline-neutral-300 rounded-sm
                  ${disabilitata ? "opacity-50 cursor-not-allowed" : ""}`}>
      <span className={`w-3.5 h-3.5 shrink-0 rounded-sm border grid place-items-center transition-colors ${
        segnata ? "bg-neutral-100 border-neutral-100" : "border-neutral-600 group-hover:border-neutral-400"}`}>
        {segnata && (
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-neutral-900" aria-hidden>
            <path d="M1 5.2 L3.8 8 L9 2" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children && <span className={segnata ? "text-neutral-200" : "text-neutral-400"}>{children}</span>}
    </button>
  );
}

/**
 * Un menu di azioni dietro tre puntini.
 *
 * Le cose che si fanno di rado — e quelle che non si annullano — non devono
 * stare ferme sullo schermo con l'aria di essere cliccabili per sbaglio. Il ✕
 * per togliere un progetto era su ogni scheda, sempre, a un dito dal titolo:
 * qui ci si arriva in due gesti e con la sua etichetta scritta per intero.
 */
/** Come chiudere il menu da dentro. Una voce che fa la sua cosa e lascia il
 *  menu aperto costringe a un clic in più per togliersi di torno il pannello,
 *  e a quel punto non si sa se l'azione è andata. */
const ChiudiMenu = createContext<() => void>(() => {});
export const useChiudiMenu = () => useContext(ChiudiMenu);

export function Altro({
  children, titolo = "Altre azioni", className = "", discreto = false,
}: {
  children: React.ReactNode;
  titolo?: string;
  className?: string;
  /** Si vede solo passandoci sopra o arrivandoci col tasto di tabulazione —
   *  ma **mai** mentre è aperto: un menu semitrasparente sotto il dito che si
   *  sposta per scegliere una voce è un menu che non si può usare. */
  discreto?: boolean;
}) {
  const [aperto, setAperto] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setAperto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAperto(false); };
    window.addEventListener("pointerdown", fuori);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", fuori); window.removeEventListener("keydown", esc); };
  }, [aperto]);
  const visibilita = !discreto || aperto
    ? "opacity-100"
    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";
  return (
    <div ref={box} className={`relative ${aperto ? "z-40" : "z-20"} transition-opacity ${visibilita} ${className}`}>
      <button type="button" title={titolo} aria-haspopup="menu" aria-expanded={aperto}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAperto((a) => !a); }}
              className={`px-1 py-0.5 rounded-sm leading-none transition-colors
                          ${aperto ? "text-neutral-100 bg-neutral-800" : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/70"}`}>
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      {aperto && (
        <ChiudiMenu.Provider value={() => setAperto(false)}>
          <div role="menu"
               className="absolute right-0 z-50 mt-1 min-w-[13rem] rounded border border-neutral-700
                          bg-neutral-950 p-1 shadow-2xl space-y-0.5">
            {children}
          </div>
        </ChiudiMenu.Provider>
      )}
    </div>
  );
}
