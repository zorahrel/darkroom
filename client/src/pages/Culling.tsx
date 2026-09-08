import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, thumbRawUrl, type PhotoListItem, type RendicontoCulling } from "../api";
import { Bott, Pills } from "../ui";
import { patchDaTasto, tastoGiudica, unisciGiudizio } from "../culling";
import { capacita } from "../guscio";

/**
 * Il culling: da qualche migliaio di scatti se ne scelgono qualche centinaio.
 *
 * Tutto qui dentro è costruito attorno a un vincolo solo: **si giudica con la
 * tastiera**. Un giudizio che costa un movimento del mouse, moltiplicato per
 * duemila scatti, costa duemila movimenti — ed è la ragione per cui gli strumenti
 * generalisti non si usano per questa fase.
 *
 * Distinto dalla stella della versione, che dice quale *render* di una foto è quello
 * buono. Qui la domanda è se la foto meriti di essere lavorata, e viene prima.
 */

const COLORI = [
  { nome: "rosso", tasto: "6", css: "#ef4444" },
  { nome: "giallo", tasto: "7", css: "#eab308" },
  { nome: "verde", tasto: "8", css: "#22c55e" },
  { nome: "blu", tasto: "9", css: "#3b82f6" },
  { nome: "viola", tasto: "0", css: "#a855f7" },
] as const;

const FILTRI = [
  { id: "all", label: "Tutte" },
  { id: "non_giudicate", label: "Da guardare" },
  { id: "tenute", label: "Tenute" },
  { id: "scartate", label: "Scartate" },
  { id: "primarie", label: "Una per raffica" },
] as const;

type Filtro = (typeof FILTRI)[number]["id"];
type Vista = "griglia" | "visore";

export default function Culling() {
  const [foto, setFoto] = useState<PhotoListItem[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("all");
  const [vista, setVista] = useState<Vista>("griglia");
  const [corrente, setCorrente] = useState(0);
  const [conto, setConto] = useState<RendicontoCulling | null>(null);
  const [motore, setMotore] = useState<boolean | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const celle = useRef<(HTMLButtonElement | null)[]>([]);
  /** Lo stato più recente, leggibile da dentro un gestore di tastiera senza
   *  aspettare il rendering. Vedi `giudica`. */
  const fotoOra = useRef<PhotoListItem[]>([]);
  /** Una coda per foto: due giudizi rapidi sullo stesso scatto si mettono in
   *  fila invece di correre. */
  const code = useRef<Map<string, Promise<unknown>>>(new Map());

  const carica = useCallback(async () => {
    const [p, r] = await Promise.all([api.listPhotos(filtro), api.rendicontoCulling()]);
    setFoto(p.photos);
    setConto(r);
    setCorrente((i) => Math.min(i, Math.max(0, p.photos.length - 1)));
  }, [filtro]);

  useEffect(() => {
    void carica();
  }, [carica]);

  useEffect(() => {
    fotoOra.current = foto;
  }, [foto]);

  useEffect(() => {
    void api.motoreCulling().then((m) => setMotore(m.disponibile));
  }, []);

  const scatto = foto[corrente];

  /** Quanti scatti per filtro: un filtro che non dice quanti nasconde non aiuta. */
  const conteggi = useMemo<Record<string, number>>(() => {
    if (!conto) return {} as Record<string, number>;
    return {
      all: conto.totale,
      non_giudicate: conto.nonGiudicati,
      tenute: conto.tenuti,
      scartate: conto.scartati,
    };
  }, [conto]);

  /**
   * Applica un giudizio in modo ottimista: la griglia deve rispondere sotto il dito,
   * non dopo il giro di rete. Se la scrittura fallisce si ricarica, e il valore
   * sbagliato dura un istante invece di restare lì a mentire.
   *
   * Il giudizio completo si costruisce da `fotoOra`, non dallo stato catturato al
   * momento in cui il gestore è stato creato. Non è pignoleria: premere `3` e poi
   * `8` nello stesso istante — stelle e poi etichetta, che è come si lavora davvero —
   * mandava due richieste costruite entrambe sul valore di *prima*, e la seconda a
   * partire cancellava il lavoro della prima. Misurato: dopo `3` e `8` restavano tre
   * stelle e nessuna etichetta.
   *
   * E le richieste sullo stesso scatto si mettono in fila, perché anche costruendole
   * bene due PUT in volo insieme arrivano nell'ordine che decide la rete.
   */
  const giudica = useCallback(
    (id: string, patch: { stelle?: number | null; colore?: string | null }) => {
      const attuale = fotoOra.current.find((x) => x.id === id);
      const completo = unisciGiudizio(
        attuale
          ? { stelle: attuale.culling_stelle ?? null, colore: attuale.culling_colore ?? null }
          : null,
        patch,
      );
      const aggiornata = (x: PhotoListItem) => ({
        ...x,
        culling_stelle: completo.stelle,
        culling_colore: completo.colore,
      });
      fotoOra.current = fotoOra.current.map((x) => (x.id === id ? aggiornata(x) : x));
      setFoto((f) => f.map((x) => (x.id === id ? aggiornata(x) : x)));

      const precedente = code.current.get(id) ?? Promise.resolve();
      const mia = precedente
        .catch(() => undefined)
        .then(() => api.giudica(id, completo))
        .then(async () => {
          setConto(await api.rendicontoCulling());
        })
        .catch(() => {
          void carica();
        });
      code.current.set(id, mia);
      return mia;
    },
    [carica],
  );

  const muovi = useCallback(
    (delta: number) => {
      setCorrente((i) => Math.max(0, Math.min(foto.length - 1, i + delta)));
    },
    [foto.length],
  );

  // La cella che si sta giudicando deve restare visibile senza doverla inseguire.
  useEffect(() => {
    celle.current[corrente]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [corrente]);

  useEffect(() => {
    function tasto(e: KeyboardEvent) {
      // Chi sta scrivendo in un campo sta scrivendo, non giudicando.
      const dove = e.target as HTMLElement | null;
      if (dove && /^(INPUT|TEXTAREA|SELECT)$/.test(dove.tagName)) return;
      if (dove?.isContentEditable) return;
      if (e.metaKey && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        setVista(e.key === "1" ? "griglia" : "visore");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Prima si stabilisce se il tasto assegna qualcosa, e solo dopo si filtra la
      // ripetizione automatica. Al contrario — filtro prima, domanda dopo — le
      // frecce verrebbero mangiate e non si scorrerebbe più.
      if (tastoGiudica(e.key)) {
        // Un tasto tenuto premuto non deve accumulare giudizi che nessuno ha inteso
        // dare: si giudica una volta per pressione.
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (!scatto) return;
        e.preventDefault();
        const patch = patchDaTasto(e.key, {
          stelle: scatto.culling_stelle ?? null,
          colore: scatto.culling_colore ?? null,
        });
        if (patch) void giudica(scatto.id, patch);
        return;
      }

      switch (e.key) {
        case "ArrowRight":
        case "]":
          e.preventDefault();
          muovi(1);
          break;
        case "ArrowLeft":
        case "[":
          e.preventDefault();
          muovi(-1);
          break;
        case "ArrowDown":
          if (vista === "griglia") {
            e.preventDefault();
            muovi(6);
          }
          break;
        case "ArrowUp":
          if (vista === "griglia") {
            e.preventDefault();
            muovi(-6);
          }
          break;
        case "Enter":
          e.preventDefault();
          setVista((v) => (v === "griglia" ? "visore" : "griglia"));
          break;
      }
    }
    // Sulla finestra e non sulla griglia: un gestore montato su una vista riceve
    // l'evento dopo quella a fuoco, e le cifre finirebbero sulla foto sbagliata.
    window.addEventListener("keydown", tasto);
    return () => window.removeEventListener("keydown", tasto);
  }, [scatto, giudica, muovi, vista]);

  async function scriviSidecar() {
    setInCorso(true);
    setMessaggio(null);
    try {
      // Due tempi: prima si dice cosa si farà, poi si fa. I sidecar finiscono nella
      // cartella del cliente, accanto ai suoi RAW.
      const piano = await api.pianoSidecar();
      if (piano.daScrivere === 0) {
        setMessaggio("Nessun sidecar da scrivere: i file dicono già quello che diremmo noi.");
        return;
      }
      const dove = piano.cartelle.join(", ");
      const ok = window.confirm(
        `Sto per scrivere ${piano.daScrivere} sidecar XMP in:\n${dove}\n\n` +
          `Ogni file esistente viene copiato in Darkroom_XMP_Backup prima di essere toccato, ` +
          `e le impostazioni di sviluppo di altri programmi restano come sono.\n\nProcedo?`,
      );
      if (!ok) return;
      const esito = await api.scriviSidecar();
      setMessaggio(
        `Scritti ${esito.scritti}, invariati ${esito.invariati}` +
          (esito.falliti.length ? `, falliti ${esito.falliti.length}` : ""),
      );
    } catch (e) {
      setMessaggio(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  }

  /**
   * Gli scatti tenuti passano alla coda AI senza uscire e rientrare dal disco.
   * È la giuntura fra i due mestieri: senza, sarebbero due programmi nella stessa
   * finestra.
   */
  async function mandaAllaRifinitura() {
    if (!conto?.tenuti) {
      setMessaggio("Non c'è ancora niente di tenuto da mandare.");
      return;
    }
    setInCorso(true);
    setMessaggio(null);
    try {
      const e = await api.rifinisciTenuti();
      setMessaggio(
        e.accodati === 0
          ? "Gli scatti tenuti hanno già un render: niente da rifare."
          : `${e.accodati} in coda per la rifinitura` +
            (e.saltati ? ` — ${e.saltati} già lavorati o scartati` : ""),
      );
    } catch (err) {
      setMessaggio(err instanceof Error ? err.message : String(err));
    } finally {
      setInCorso(false);
    }
  }

  async function trovaRaffiche() {
    setInCorso(true);
    setMessaggio(null);
    try {
      // A lotti, non in un colpo: il server chiude una connessione ferma da dieci
      // secondi, e le firme di un archivio vero ci mettono minuti. Il ciclo
      // permette anche di dire a che punto siamo invece di lasciare una clessidra.
      let calcolate = 0;
      let fallite = 0;
      for (;;) {
        const passata = await api.calcolaFirme();
        calcolate += passata.calcolate;
        fallite += passata.fallite;
        if (passata.restanti === 0) break;
        setMessaggio(`Firme: ${calcolate} fatte, ${passata.restanti} da fare…`);
      }
      const g = await api.raggruppaRaffiche();
      setMessaggio(
        `${g.gruppi} raffiche su ${g.scatti} scatti` +
          (fallite ? ` — ${fallite} illeggibili` : "") +
          (g.manualiRispettate ? ` — ${g.manualiRispettate} correzioni a mano rispettate` : ""),
      );
      await carica();
    } catch (e) {
      setMessaggio(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  }

  if (motore === false) {
    return (
      <div className="p-6 text-sm text-neutral-300 space-y-2">
        <p className="text-neutral-100">Il motore nativo non è compilato.</p>
        <p className="text-neutral-400">
          Senza, le anteprime dei RAW passerebbero da <code>sips</code>: 1859 ms per foto
          invece di 2,1. Su duemila scatti è un'ora invece di sedici secondi.
        </p>
        <pre className="bg-neutral-900 rounded p-3 text-xs">bun run core:build</pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-neutral-800">
        <Pills
          items={FILTRI.map((f) => ({ id: f.id, name: f.label }))}
          pick={filtro}
          onChoose={(v) => setFiltro(v as Filtro)}
          counts={conteggi}
        />
        <div className="flex gap-1 ml-auto text-xs">
          <Bott onClick={() => setVista("griglia")} weight={vista === "griglia" ? "primary" : "quiet"}>
            Griglia
          </Bott>
          <Bott onClick={() => setVista("visore")} weight={vista === "visore" ? "primary" : "quiet"}>
            Visore
          </Bott>
        </div>
        <Bott onClick={trovaRaffiche} disabled={inCorso} weight="quiet">
          Trova le raffiche
        </Bott>
        <Bott onClick={scriviSidecar} disabled={inCorso} weight="normal">
          Scrivi i sidecar…
        </Bott>
        <Bott onClick={mandaAllaRifinitura} disabled={inCorso} weight="primary">
          Manda alla rifinitura
        </Bott>
      </header>

      {conto && (
        <div className="px-4 py-2 text-xs text-neutral-400 border-b border-neutral-900 flex gap-4 flex-wrap">
          <span>{conto.totale} scatti</span>
          <span className="text-green-400">{conto.tenuti} tenuti</span>
          <span className="text-neutral-500">{conto.scartati} scartati</span>
          <span>{conto.nonGiudicati} da guardare</span>
          {messaggio && <span className="text-amber-400">{messaggio}</span>}
        </div>
      )}

      {vista === "visore" && scatto ? (
        <Visore scatto={scatto} />
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
            {foto.map((f, i) => (
              <Cella
                key={f.id}
                riferimento={(el) => (celle.current[i] = el)}
                scatto={f}
                scelta={i === corrente}
                onClick={() => setCorrente(i)}
              />
            ))}
          </div>
          {foto.length === 0 && (
            <p className="text-neutral-500 text-sm p-4">Nessuno scatto con questo filtro.</p>
          )}
        </div>
      )}

      {!capacita().cartellaLocale && (
        <div className="px-4 py-1.5 text-[11px] text-neutral-500 border-t border-neutral-900">
          Nel browser si lavora sulle foto già indicizzate. Aprire una cartella del
          disco richiede l'applicazione desktop: una pagina web non può leggere il
          filesystem, e offrirlo per poi fallire sarebbe peggio che dirlo.
        </div>
      )}

      <Legenda />
    </div>
  );
}

function Cella({
  scatto,
  scelta,
  onClick,
  riferimento,
}: {
  scatto: PhotoListItem;
  scelta: boolean;
  onClick: () => void;
  riferimento: (el: HTMLButtonElement | null) => void;
}) {
  const colore = COLORI.find((c) => c.nome === scatto.culling_colore);
  return (
    <button
      ref={riferimento}
      onClick={onClick}
      className={`relative block rounded overflow-hidden bg-neutral-900 aspect-[3/2] outline-none ${
        scelta ? "ring-2 ring-sky-400" : "ring-1 ring-neutral-800"
      }`}
    >
      <img
        src={thumbRawUrl(scatto.id, 512, scatto.original_path)}
        alt=""
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover"
      />
      {colore && (
        <span
          className="absolute top-1 left-1 w-3 h-3 rounded-full ring-1 ring-black/40"
          style={{ background: colore.css }}
          title={colore.nome}
        />
      )}
      {scatto.culling_stelle !== null && scatto.culling_stelle !== undefined && (
        <span className="absolute bottom-1 left-1 text-[11px] px-1 rounded bg-black/70 text-amber-300">
          {scatto.culling_stelle === 0 ? "—" : "★".repeat(scatto.culling_stelle)}
        </span>
      )}
      {scatto.culling_gruppo && (
        <span
          className="absolute top-1 right-1 text-[10px] px-1 rounded bg-black/70 text-neutral-300"
          title="fa parte di una raffica"
        >
          {scatto.culling_primaria ? "◆" : "◇"}
        </span>
      )}
    </button>
  );
}

function Visore({ scatto }: { scatto: PhotoListItem }) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-black">
      {/* 2048 e non 512: qui si decide se lo scatto è a fuoco, e a mezza
          risoluzione quella domanda non si può rispondere. */}
      <img
        src={thumbRawUrl(scatto.id, 2048, scatto.original_path)}
        alt={scatto.id}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

function Legenda() {
  return (
    <footer className="px-4 py-2 border-t border-neutral-800 text-[11px] text-neutral-500 flex gap-4 flex-wrap">
      <span>
        <b className="text-neutral-300">1-5</b> stelle
      </span>
      {COLORI.map((c) => (
        <span key={c.nome}>
          <b className="text-neutral-300">{c.tasto}</b>{" "}
          <span style={{ color: c.css }}>{c.nome}</span>
        </span>
      ))}
      <span>
        <b className="text-neutral-300">\</b> togli il giudizio
      </span>
      <span>
        <b className="text-neutral-300">← →</b> scorri
      </span>
      <span>
        <b className="text-neutral-300">Invio</b> griglia / visore
      </span>
    </footer>
  );
}
