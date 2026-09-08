import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsonFetch, pq } from "../api";
import { Bott } from "../ui";
import { capacita } from "../guscio";

/**
 * Il girato: si sceglie cosa tenere, non si monta.
 *
 * È la stessa domanda del culling posta al video, e ha la stessa risposta: la
 * tastiera. Da una giornata escono trecento clip e in montaggio ne entrano trenta;
 * farlo dentro un programma di montaggio significa aprire un progetto e importare
 * decine di gigabyte per rispondere a «questa la tengo?».
 *
 * Due viste sullo stesso materiale, come le due del culling: la **griglia** per
 * decidere, la **fila** per guardare e tagliare.
 */

type Clip = {
  nome: string;
  percorso: string;
  byte: number;
  durata: number | null;
  larghezza: number | null;
  altezza: number | null;
  fotogrammiAlSecondo: number | null;
  conAudio: boolean;
  illeggibile: string | null;
  livePhoto: boolean;
};

type Scelta = {
  nome: string;
  tenuta: boolean;
  attacco: number | null;
  stacco: number | null;
  posizione: number;
  nota: string | null;
};

type Risposta = {
  cartella: string;
  clip: Clip[];
  scelte: Scelta[];
  durataTenuta: number;
  perchePerSilenzio: string | null;
  illeggibili: number;
  livePhoto: number;
};

const RICORDO = "darkroom.girato.cartella";

function durata(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m > 0 ? `${m}′${r.toFixed(0).padStart(2, "0")}″` : `${r.toFixed(1)}″`;
}

export default function Girato() {
  const [cartella, setCartella] = useState(
    () => localStorage.getItem(RICORDO) ?? "",
  );
  const [campo, setCampo] = useState(cartella);
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricando, setCaricando] = useState(false);
  const [vista, setVista] = useState<"griglia" | "fila">("griglia");
  const [corrente, setCorrente] = useState(0);
  const [mutoDeciso, setMutoDeciso] = useState(true);
  const [soloTenute, setSoloTenute] = useState(false);

  const carica = useCallback(async (dir: string) => {
    if (!dir) return;
    setCaricando(true);
    setErrore(null);
    try {
      const r = await jsonFetch<Risposta>(
        `/api/girato?cartella=${encodeURIComponent(dir)}`,
      );
      setDati(r);
      localStorage.setItem(RICORDO, dir);
      setCartella(dir);
    } catch (e) {
      setDati(null);
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setCaricando(false);
    }
  }, []);

  useEffect(() => {
    if (cartella) void carica(cartella);
    // Solo alla prima apertura: dopo, si ricarica su richiesta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Le clip nell'ordine della fila, con la loro scelta accanto. */
  const fila = useMemo(() => {
    if (!dati) return [];
    const perNome = new Map(dati.clip.map((c) => [c.nome, c]));
    return [...dati.scelte]
      .sort((a, b) => a.posizione - b.posizione)
      .map((s) => ({ s, c: perNome.get(s.nome) }))
      .filter((x): x is { s: Scelta; c: Clip } => !!x.c)
      .filter((x) => !soloTenute || x.s.tenuta);
  }, [dati, soloTenute]);

  const attuale = fila[corrente];

  /**
   * Salva subito, non fra poco.
   *
   * Un salvataggio rimandato che l'uscita dalla vista annulla invece di eseguire è
   * un difetto documentato: un taglio fatto mezzo secondo prima di cambiare cartella
   * spariva senza dire niente. Qui ogni scelta va sul disco quando viene presa.
   */
  const salva = useCallback(
    async (scelte: Scelta[]) => {
      if (!dati) return;
      setDati({ ...dati, scelte });
      try {
        await jsonFetch(`/api/girato/scelte?cartella=${encodeURIComponent(dati.cartella)}`, {
          method: "POST",
          body: JSON.stringify({ scelte }),
        });
      } catch (e) {
        setErrore(e instanceof Error ? e.message : String(e));
        void carica(dati.cartella);
      }
    },
    [dati, carica],
  );

  const cambia = useCallback(
    (nome: string, patch: Partial<Scelta>) => {
      if (!dati) return;
      void salva(dati.scelte.map((s) => (s.nome === nome ? { ...s, ...patch } : s)));
    },
    [dati, salva],
  );

  async function sposta(da: number, a: number) {
    if (!dati) return;
    const r = await jsonFetch<{ scelte: Scelta[] }>(
      `/api/girato/riordina?cartella=${encodeURIComponent(dati.cartella)}`,
      { method: "POST", body: JSON.stringify({ da, a }) },
    );
    setDati({ ...dati, scelte: r.scelte });
  }

  useEffect(() => {
    function tasto(e: KeyboardEvent) {
      const dove = e.target as HTMLElement | null;
      if (dove && /^(INPUT|TEXTAREA|SELECT)$/.test(dove.tagName)) return;
      if (!attuale) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Come nel culling: prima si stabilisce se il tasto decide qualcosa, poi si
      // filtra la ripetizione. Al contrario, le frecce verrebbero mangiate.
      const decide = ["k", "K", "x", "X", "i", "I", "o", "O", "u", "U"].includes(e.key);
      if (decide) {
        if (e.repeat) return void e.preventDefault();
        e.preventDefault();
        const t = attuale.c.durata ? Math.min(attuale.c.durata, tempo) : tempo;
        if (e.key.toLowerCase() === "k") cambia(attuale.s.nome, { tenuta: true });
        else if (e.key.toLowerCase() === "x") cambia(attuale.s.nome, { tenuta: false });
        else if (e.key.toLowerCase() === "i") cambia(attuale.s.nome, { attacco: t });
        else if (e.key.toLowerCase() === "o") cambia(attuale.s.nome, { stacco: t });
        else cambia(attuale.s.nome, { attacco: null, stacco: null });
        return;
      }
      if (e.key === "ArrowRight" || e.key === "]") {
        e.preventDefault();
        setCorrente((i) => Math.min(fila.length - 1, i + 1));
      } else if (e.key === "ArrowLeft" || e.key === "[") {
        e.preventDefault();
        setCorrente((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        setVista((v) => (v === "griglia" ? "fila" : "griglia"));
      }
    }
    window.addEventListener("keydown", tasto);
    return () => window.removeEventListener("keydown", tasto);
  });

  const video = useRef<HTMLVideoElement>(null);
  const [tempo, setTempo] = useState(0);

  const urlClip = (nome: string) =>
    dati ? pq(`/api/girato/clip?cartella=${encodeURIComponent(dati.cartella)}&clip=${encodeURIComponent(nome)}`) : "";
  const urlFotogramma = (nome: string, t: number, w: number) =>
    dati
      ? pq(
          `/api/girato/fotogramma?cartella=${encodeURIComponent(dati.cartella)}&clip=${encodeURIComponent(nome)}&t=${t}&w=${w}`,
        )
      : "";

  const tenute = dati?.scelte.filter((s) => s.tenuta).length ?? 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-neutral-800">
        <input
          value={campo}
          onChange={(e) => setCampo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void carica(campo.trim())}
          placeholder="/percorso/della/cartella con le riprese"
          className="min-w-0 flex-1 sm:flex-none sm:w-96 min-h-11 sm:min-h-0 px-2 py-1.5 rounded bg-neutral-950 border border-neutral-800 text-sm"
        />
        <Bott onClick={() => void carica(campo.trim())} disabled={caricando} weight="normal">
          {caricando ? "Leggo…" : "Apri"}
        </Bott>
        {dati && (
          <>
            <div className="flex gap-1">
              <Bott onClick={() => setVista("griglia")} weight={vista === "griglia" ? "primary" : "quiet"}>
                Griglia
              </Bott>
              <Bott onClick={() => setVista("fila")} weight={vista === "fila" ? "primary" : "quiet"}>
                Fila
              </Bott>
            </div>
            <Bott onClick={() => setSoloTenute((v) => !v)} weight={soloTenute ? "primary" : "quiet"}>
              Solo tenute
            </Bott>
            <Bott onClick={() => setMutoDeciso((v) => !v)} weight="quiet">
              {mutoDeciso ? "Muto" : "Audio"}
            </Bott>
          </>
        )}
      </header>

      {errore && (
        <div className="px-4 py-2 text-sm text-rose-300 bg-rose-950/30 border-b border-rose-900">
          {errore}
        </div>
      )}

      {dati && (
        <div className="px-4 py-2 text-xs text-neutral-400 border-b border-neutral-900 flex flex-wrap gap-4">
          <span>{dati.clip.length} clip</span>
          <span className="text-green-400">{tenute} tenute</span>
          <span>{durata(dati.durataTenuta)} di montato</span>
          {dati.livePhoto > 0 && <span>{dati.livePhoto} da Live Photo</span>}
          {dati.illeggibili > 0 && (
            <span className="text-amber-400">{dati.illeggibili} non si aprono</span>
          )}
          {/* Un silenzio senza spiegazione manda a cercare un guasto dove non c'è. */}
          {dati.perchePerSilenzio && (
            <span className="text-amber-400">Nessun suono: {dati.perchePerSilenzio}</span>
          )}
        </div>
      )}

      {!dati && !caricando && (
        <div className="p-6 text-sm text-neutral-400 space-y-2">
          <p className="text-neutral-200">Indica la cartella con le riprese.</p>
          <p>
            Le clip non vengono copiate né toccate: restano dove sono, e accanto a loro
            finisce un solo file con le scelte — quali si tengono, dove attaccano e dove
            staccano. Non le riprese.
          </p>
          {!capacita().cartellaLocale && (
            <p className="text-neutral-500">
              Nel browser il percorso si scrive a mano: scegliere una cartella con una
              finestra di sistema richiede l'applicazione desktop.
            </p>
          )}
        </div>
      )}

      {dati && vista === "griglia" && (
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {fila.map((x, i) => (
              <button
                key={x.s.nome}
                onClick={() => {
                  setCorrente(i);
                  setVista("fila");
                }}
                className={`relative block text-left rounded overflow-hidden bg-neutral-900 ${
                  i === corrente ? "ring-2 ring-sky-400" : "ring-1 ring-neutral-800"
                } ${x.s.tenuta ? "" : "opacity-40"}`}
              >
                <div className="aspect-video bg-black">
                  {x.c.illeggibile ? (
                    <div className="w-full h-full flex items-center justify-center text-[11px] text-amber-400 px-2 text-center">
                      non si apre
                    </div>
                  ) : (
                    <img
                      src={urlFotogramma(x.s.nome, (x.c.durata ?? 2) / 2, 400)}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="px-2 py-1 text-[11px] flex items-center gap-2">
                  <span className="truncate">{x.s.nome}</span>
                  <span className="ml-auto text-neutral-500 tabular-nums shrink-0">
                    {durata(x.c.durata)}
                  </span>
                </div>
                {!x.c.conAudio && (
                  <span className="absolute top-1 right-1 text-[10px] px-1 rounded bg-black/70 text-neutral-400">
                    muta
                  </span>
                )}
                {x.c.livePhoto && (
                  <span className="absolute top-1 left-1 text-[10px] px-1 rounded bg-black/70 text-neutral-400">
                    Live
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {dati && vista === "fila" && attuale && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 bg-black flex items-center justify-center">
            {attuale.c.illeggibile ? (
              <p className="text-amber-400 text-sm px-4 text-center">
                {attuale.s.nome}: {attuale.c.illeggibile}
              </p>
            ) : (
              <video
                ref={video}
                key={attuale.s.nome}
                src={urlClip(attuale.s.nome)}
                controls
                muted={mutoDeciso}
                onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
                className="max-h-full max-w-full"
              />
            )}
          </div>

          <div className="px-4 py-2 border-t border-neutral-800 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono">{attuale.s.nome}</span>
            <span className="text-neutral-500 tabular-nums">
              {tempo.toFixed(2)}″ / {durata(attuale.c.durata)}
            </span>
            <span className="text-neutral-500">
              attacco {attuale.s.attacco?.toFixed(2) ?? "0.00"}″ · stacco{" "}
              {attuale.s.stacco?.toFixed(2) ?? durata(attuale.c.durata)}
            </span>
            <div className="ml-auto flex flex-wrap gap-1">
              <Bott
                onClick={() => cambia(attuale.s.nome, { tenuta: !attuale.s.tenuta })}
                weight={attuale.s.tenuta ? "primary" : "normal"}
              >
                {attuale.s.tenuta ? "Tenuta" : "Scartata"}
              </Bott>
              <Bott onClick={() => cambia(attuale.s.nome, { attacco: tempo })} weight="quiet">
                Attacca qui
              </Bott>
              <Bott onClick={() => cambia(attuale.s.nome, { stacco: tempo })} weight="quiet">
                Stacca qui
              </Bott>
              <Bott
                onClick={() => cambia(attuale.s.nome, { attacco: null, stacco: null })}
                weight="quiet"
              >
                Intera
              </Bott>
              <Bott onClick={() => void sposta(corrente, Math.max(0, corrente - 1))} weight="quiet">
                ←
              </Bott>
              <Bott
                onClick={() => void sposta(corrente, Math.min(fila.length - 1, corrente + 1))}
                weight="quiet"
              >
                →
              </Bott>
            </div>
          </div>

          {/* La striscia: dove si è nella fila, senza uscire dalla clip aperta. */}
          <div className="flex gap-1 overflow-x-auto px-2 py-2 border-t border-neutral-900">
            {fila.map((x, i) => (
              <button
                key={x.s.nome}
                onClick={() => setCorrente(i)}
                title={x.s.nome}
                className={`shrink-0 w-28 rounded overflow-hidden ${
                  i === corrente ? "ring-2 ring-sky-400" : "ring-1 ring-neutral-800"
                } ${x.s.tenuta ? "" : "opacity-40"}`}
              >
                <img
                  src={urlFotogramma(x.s.nome, (x.c.durata ?? 2) / 2, 200)}
                  alt=""
                  loading="lazy"
                  className="w-full aspect-video object-cover bg-black"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <footer className="px-4 py-2 border-t border-neutral-800 text-[11px] text-neutral-500 flex gap-4 flex-wrap">
        <span><b className="text-neutral-300">K</b> tieni</span>
        <span><b className="text-neutral-300">X</b> scarta</span>
        <span><b className="text-neutral-300">I</b> attacca</span>
        <span><b className="text-neutral-300">O</b> stacca</span>
        <span><b className="text-neutral-300">U</b> intera</span>
        <span><b className="text-neutral-300">← →</b> scorri</span>
        <span><b className="text-neutral-300">Invio</b> griglia / fila</span>
      </footer>
    </div>
  );
}
