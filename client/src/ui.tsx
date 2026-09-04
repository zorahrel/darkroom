import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, Search as SearchIcon } from "lucide-react";

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
export type Weight = "primario" | "normale" | "quieto" | "pericolo";

const WEIGHT: Record<Weight, string> = {
  primario: "border-transparent bg-neutral-100 text-neutral-900 hover:bg-white font-medium",
  normale: "border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:text-neutral-100",
  quieto: "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/70",
  pericolo: "border-rose-800 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50",
};

export function Bott({
  children, onClick, active, weight = "normale", taglia = "m",
  title, disabilitato, className = "", tipo = "button",
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  /** Stato acceso di un interruttore: si vede senza doverlo leggere. */
  active?: boolean;
  weight?: Weight;
  taglia?: Taglia;
  title?: string;
  disabilitato?: boolean;
  className?: string;
  tipo?: "button" | "submit";
}) {
  const stile = disabilitato
    ? "border-neutral-800 text-neutral-400/50 cursor-not-allowed"
    : active
      ? "border-neutral-400 bg-neutral-800 text-neutral-100"
      : WEIGHT[weight];
  return (
    <button
      type={tipo}
      title={title}
      disabled={disabilitato}
      aria-pressed={active}
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
export function Confirm({
  children, domanda, confirm, onConfirm, taglia = "m", title, className = "",
}: {
  /** Il richiamo, sempre quieto. */
  children: React.ReactNode;
  /** Che cosa succede, detto per intero. */
  domanda: string;
  /** Il testo del bottone rosso: un verbo, non "ok". */
  confirm: string;
  onConfirm: () => void;
  taglia?: Taglia;
  title?: string;
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
      <Bott weight="quieto" taglia={taglia} title={title} className={className}
            onClick={() => setChiesto(true)}>
        {children}
      </Bott>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-neutral-300">{domanda}</span>
      <Bott weight="pericolo" taglia={taglia} onClick={() => { setChiesto(false); onConfirm(); }}>
        {confirm}
      </Bott>
      <Bott weight="quieto" taglia={taglia} onClick={() => setChiesto(false)}>lascia stare</Bott>
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
export function Shortcut({ children }: { children: React.ReactNode }) {
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
export function VerdictButton({
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
      <Shortcut>{tasto}</Shortcut>
    </button>
  );
}

export function Badge({
  children, tono = "neutro", title, className = "",
}: {
  children: React.ReactNode;
  tono?: "neutro" | "buono" | "attesa" | "male" | "info";
  title?: string;
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
    <span title={title}
          className={`inline-flex items-center gap-1 border rounded-sm px-1.5 py-[1px]
                      text-[10.5px] whitespace-nowrap ${t} ${className}`}>
      {children}
    </span>
  );
}

/** Un interruttore: acceso/spento si legge dalla forma, non dalla parola. */
export function Toggle({
  on, onChange, onText, offText, title,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  onText: string;
  offText: string;
  title?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} title={title}
            onClick={() => onChange(!on)}
            className="inline-flex items-center gap-1.5 text-[11px] group">
      <span className={`w-6 h-3.5 rounded-full border transition-colors relative shrink-0 ${
        on ? "bg-emerald-800/70 border-emerald-600" : "bg-neutral-800 border-neutral-600"}`}>
        <span className={`absolute top-[1px] w-[10px] h-[10px] rounded-full transition-all ${
          on ? "left-[12px] bg-emerald-300" : "left-[1px] bg-neutral-400"}`} />
      </span>
      <span className={on ? "text-neutral-200" : "text-neutral-400"}>
        {on ? onText : offText}
      </span>
    </button>
  );
}

/** L'intestazione di una pagina: titolo e, sotto, cosa ci si fa. */
export function Header({
  title, sotto, children,
}: { title: string; sotto?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 flex-wrap">
      <div className="min-w-0 space-y-0.5">
        <h1 className="text-[17px] font-semibold tracking-tight leading-tight">{title}</h1>
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
  value, items, onChange, width = 120, title, taglia = "s",
}: {
  value: T;
  /** `gruppo` mette una riga di titolo prima della voce: serve quando l'elenco
   *  è lungo e diviso per famiglia (le LUT, per dire). */
  items: { v: T; text: string; nota?: string; group?: string }[];
  onChange: (v: T) => void;
  width?: number;
  title?: string;
  taglia?: Taglia;
}) {
  const [open, setOpen] = useState(false);
  const [evidenziato, setEvidenziato] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const pick = items.find((x) => x.v === value);
  const t = taglia === "s" ? "text-[10.5px] px-1.5 py-0.5" : "text-[12px] px-2 py-1";

  useEffect(() => {
    if (!open) return;
    setEvidenziato(Math.max(0, items.findIndex((x) => x.v === value)));
    const fuori = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", fuori);
    return () => window.removeEventListener("pointerdown", fuori);
  }, [open, items, value]);

  const tasti = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
      return;
    }
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setEvidenziato((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setEvidenziato((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setEvidenziato(0); }
    else if (e.key === "End") { e.preventDefault(); setEvidenziato(items.length - 1); }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const v = items[evidenziato];
      if (v) { onChange(v.v); setOpen(false); }
    }
  };

  return (
    <div ref={box} className="relative" style={{ width: width }}>
      <button
        type="button" title={title} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((a) => !a)} onKeyDown={tasti}
        className={`w-full flex items-center gap-1 rounded-sm border border-neutral-700
                    bg-neutral-950 text-neutral-200 text-left ${t}
                    hover:border-neutral-500 focus:outline-none focus:border-neutral-300`}>
        <span className="truncate flex-1">{pick?.text ?? value}</span>
        <span className="text-neutral-400 text-[8px] leading-none">▾</span>
      </button>
      {open && (
        <ul role="listbox" id={id}
            className="absolute z-50 mt-0.5 w-full max-h-[46vh] overflow-y-auto bg-neutral-950
                       border border-neutral-700 rounded-sm shadow-2xl py-0.5">
          {items.map((x, i) => (
            <li key={x.v} role="option" aria-selected={x.v === value}>
              {x.group && x.group !== items[i - 1]?.group && (
                <div className="px-1.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
                  {x.group}
                </div>
              )}
              <button
                type="button"
                onPointerEnter={() => setEvidenziato(i)}
                onClick={() => { onChange(x.v); setOpen(false); }}
                className={`w-full flex items-baseline gap-2 px-1.5 py-1 text-left text-[10.5px]
                            ${i === evidenziato ? "bg-neutral-800 text-neutral-100" : "text-neutral-300"}`}>
                <span className="truncate flex-1">{x.text}</span>
                {x.nota && <span className="text-neutral-400 tabular-nums shrink-0">{x.nota}</span>}
                {x.v === value && <span className="text-emerald-400 shrink-0">✓</span>}
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
export function Field({
  value, onChange, segnaposto, onInvio, onEsc, autoFuoco, taglia = "s", className = "",
}: {
  value: string;
  onChange: (v: string) => void;
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
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
  value, onChange, segnaposto, onEsc, onInvia, autoFuoco, className = "",
}: {
  value: string;
  onChange: (v: string) => void;
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
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
export function NumberField({
  value, onChange, min = 1, max = 4096, step = 1, width = 62, title,
}: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; width?: number; title?: string;
}) {
  const limita = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center rounded-sm border border-neutral-700 bg-neutral-950"
         style={{ width: width }} title={title}>
      <input
        value={value}
        onChange={(e) => { const n = Number(e.target.value.replace(/[^0-9.]/g, "")); if (Number.isFinite(n)) onChange(n); }}
        onBlur={() => onChange(limita(value))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowUp") { e.preventDefault(); onChange(limita(value + step)); }
          if (e.key === "ArrowDown") { e.preventDefault(); onChange(limita(value - step)); }
        }}
        className="appearance-none w-full bg-transparent px-1.5 py-0.5 text-[10.5px] text-neutral-100
                   tabular-nums outline-none"
      />
      <div className="flex flex-col border-l border-neutral-800">
        <button type="button" onClick={() => onChange(limita(value + step))}
                className="px-1 text-[7px] leading-[9px] text-neutral-400 hover:text-neutral-100">▲</button>
        <button type="button" onClick={() => onChange(limita(value - step))}
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
export function Checkbox({
  segnata, onChange, children, title, disabilitata,
}: {
  segnata: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
  title?: string;
  disabilitata?: boolean;
}) {
  return (
    <button
      type="button" role="checkbox" aria-checked={segnata} title={title} disabled={disabilitata}
      onClick={() => onChange(!segnata)}
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
const CloseMenu = createContext<() => void>(() => {});
export const useCloseMenu = () => useContext(CloseMenu);

export function Altro({
  children, title = "Altre azioni", className = "", discreto = false,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
  /** Si vede solo passandoci sopra o arrivandoci col tasto di tabulazione —
   *  ma **mai** mentre è aperto: un menu semitrasparente sotto il dito che si
   *  sposta per scegliere una voce è un menu che non si può usare. */
  discreto?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fuori = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", fuori);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", fuori); window.removeEventListener("keydown", esc); };
  }, [open]);
  const visibilita = !discreto || open
    ? "opacity-100"
    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";
  return (
    <div ref={box} className={`relative ${open ? "z-40" : "z-20"} transition-opacity ${visibilita} ${className}`}>
      <button type="button" title={title} aria-haspopup="menu" aria-expanded={open}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((a) => !a); }}
              className={`px-1 py-0.5 rounded-sm leading-none transition-colors
                          ${open ? "text-neutral-100 bg-neutral-800" : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/70"}`}>
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      {open && (
        <CloseMenu.Provider value={() => setOpen(false)}>
          <div role="menu"
               className="absolute right-0 z-50 mt-1 min-w-[13rem] rounded border border-neutral-700
                          bg-neutral-950 p-1 shadow-2xl space-y-0.5">
            {children}
          </div>
        </CloseMenu.Provider>
      )}
    </div>
  );
}

/**
 * Le pastiglie di filtro con il conteggio.
 *
 * Nate nella griglia, ricopiate a mano nell'albero, e in procinto di esserlo
 * una terza volta nei riferimenti: tre copie della stessa cosa divergono al
 * primo ritocco, ed e' cosi' che una sezione si ritrova con i filtri di ieri.
 *
 * Il conteggio non e' decorazione: un filtro che porta a una pagina vuota va
 * saputo PRIMA di cliccarlo. Per la stessa ragione una voce a zero si disabilita
 * invece di sparire — sparire sposterebbe le altre sotto il dito proprio mentre
 * si sta per premere.
 */
export function Pills<T extends string>({
  items,
  pick,
  onScegli,
  counts,
  /** La voce che non filtra: resta sempre premibile anche a zero, perche' e'
   *  la via d'uscita da un filtro che non mostra niente. */
  neutra,
  className = "",
}: {
  items: readonly { id: T; name: string }[];
  pick: T;
  onScegli: (v: T) => void;
  counts: Record<string, number>;
  neutra?: T;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 shrink-0 ${className}`}>
      {items.map((v) => {
        const n = counts[v.id] ?? 0;
        const active = pick === v.id;
        return (
          <button
            key={v.id}
            onClick={() => onScegli(v.id)}
            disabled={n === 0 && v.id !== neutra}
            title={`${v.name}: ${n}`}
            className={
              "px-1.5 py-0.5 border font-mono uppercase tracking-wide text-[10px] disabled:opacity-30 " +
              (active
                ? "border-amber-500 text-amber-500"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-600")
            }
          >
            {v.name}
            <span className="ml-1 opacity-60 tabular-nums">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Una voce di filtro con il suo numero.
 *
 * Il numero non è decorazione: un filtro senza conteggio non dice se vale la
 * pena aprirlo, e quello a zero si spegne da solo invece di portare su un
 * elenco vuoto. Sta qui perché lo usano la home degli strumenti e l'elenco dei
 * progetti, e due barre di filtri che si somigliano ma non coincidono si
 * leggono come due cose diverse.
 */
export function Filter({
  children, active, onClick, n, title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  n: number;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={n === 0 && !active}
      title={title}
      aria-pressed={active}
      className={
        // py-1, non py-0.5: a 22px di altezza il bersaglio era sotto la soglia
        // sotto la quale si sbaglia pastiglia, e queste stanno appaiate.
        "px-2 py-1 border rounded-sm text-[11px] leading-[14px] transition-colors disabled:opacity-30 " +
        (active
          ? "border-neutral-300 text-neutral-100"
          : "border-neutral-800 text-neutral-400 hover:border-neutral-600")
      }
    >
      {children}
      <span className="ml-1 opacity-60 tabular-nums">{n}</span>
    </button>
  );
}

/** Il campo di ricerca di una barra filtri: la lente sta dentro, non accanto. */
export function Search({
  value, onChange, segnaposto, width = "13rem",
}: {
  value: string;
  onChange: (v: string) => void;
  segnaposto?: string;
  width?: string;
}) {
  return (
    <div className="relative">
      <SearchIcon className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onChange("");
        }}
        placeholder={segnaposto}
        style={{ width: width }}
        className="appearance-none bg-neutral-950 border border-neutral-700 rounded-sm pl-7 pr-2 py-1
                   text-[12px] text-neutral-100 placeholder:text-neutral-500 outline-none
                   focus:border-neutral-300"
      />
    </div>
  );
}
