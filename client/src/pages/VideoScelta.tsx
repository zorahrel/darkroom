import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, pq, type VideoShot, type VideoJob } from "../api";

/**
 * Giudicare le scene, una alla volta.
 *
 * La griglia serve a sfogliare, questa serve a decidere, e le due cose vogliono
 * layout diversi. Nella griglia due verticali 9:16 dentro una tessera fanno
 * ~80px l'una: a quella dimensione i difetti che contano non si vedono — il
 * buco bianco sulla schiena di `g_scal1` era passato due volte prima che
 * qualcuno aprisse quella ripresa da sola.
 *
 * Il giudizio e' l'unica cosa della catena che una misura non sa dare. Ne sono
 * state provate tre (bilancio tonale, area di dettaglio, salto della sagoma) e
 * nessuna separa una figura che si scioglie da una che entra in un'onda:
 * l'indice di `d02`, che si sfascia a vista, sta in mezzo al gruppo.
 */

/** Una scena e' una PRESA, non un file: `z43_0` e `z43_1` sono due meta' della
 *  stessa generazione e giudicarle separate e' la ragione per cui il montaggio
 *  sembrava pieno di doppioni pur avendo 122 nomi diversi. */
type Scena = {
  origine: string;
  pezzi: VideoShot[];
  atto: string | null;
  minuto: number | null;
  inScena: number;
  kept: boolean;
  /** Il verdetto dato, se c'è. `null` vuol dire mai passata sotto gli occhi —
   *  che non è la stessa cosa di "tenuta": tenere è lo stato di partenza. */
  giudizio: "tenuta" | "scartata" | null;
  giudicataIl: number | null;
  annotata: boolean;
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function raggruppa(shots: VideoShot[]): Scena[] {
  const per = new Map<string, VideoShot[]>();
  for (const s of shots) per.set(s.origine, [...(per.get(s.origine) ?? []), s]);
  return [...per.entries()]
    .map(([origine, pezzi]) => {
      const inM = pezzi.filter((p) => p.minuto !== null);
      return {
        origine,
        pezzi: pezzi.sort((a, b) => a.id.localeCompare(b.id)),
        atto: inM[0]?.atto ?? null,
        minuto: inM.length ? Math.min(...inM.map((p) => p.minuto!)) : null,
        inScena: pezzi.reduce((n, p) => n + p.inScena, 0),
        // Una presa e' "tenuta" se almeno un pezzo lo e'.
        kept: pezzi.some((p) => p.kept),
        // Il verdetto della presa: basta un pezzo scartato perche' lo sia, e
        // serve almeno un si' esplicito perche' conti come approvata.
        giudizio: (pezzi.some((p) => p.giudizio === "scartata") ? "scartata"
                 : pezzi.some((p) => p.giudizio === "tenuta") ? "tenuta"
                 : null) as Scena["giudizio"],
        giudicataIl: pezzi.reduce<number | null>(
          (m, p) => (p.giudicataIl && (!m || p.giudicataIl > m) ? p.giudicataIl : m), null),
        annotata: pezzi.some((p) => p.problemi.length > 0),
      };
    })
    .sort((a, b) => (a.minuto ?? 1e9) - (b.minuto ?? 1e9) || a.origine.localeCompare(b.origine));
}

type Filtro = "da giudicare" | "tenute" | "scartate" | "annotate" | "in montaggio" | "tutte";

export default function VideoScelta() {
  const { pid } = useParams();
  const [shots, setShots] = useState<VideoShot[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("da giudicare");
  const [atto, setAtto] = useState<string>("");
  const [i, setI] = useState(0);
  const [pezzo, setPezzo] = useState(0);
  const [nota, setNota] = useState<string | null>(null);
  const [testo, setTesto] = useState("");
  const [rigen, setRigen] = useState(false);
  const [promptMod, setPromptMod] = useState("");
  const [par, setPar] = useState({ width: 640, height: 1152, length: 61, steps: 20 });
  const [jobs, setJobs] = useState<VideoJob[]>([]);

  /** Anche qui l'altezza si misura: la clip deve prendere lo schermo che c'è,
   *  e la pagina non deve scorrere mentre si giudica a raffica. */
  const guscio = useRef<HTMLDivElement>(null);
  const [hGuscio, setHGuscio] = useState(700);
  useLayoutEffect(() => {
    const misura = () => {
      const el = guscio.current;
      if (!el) return;
      const padre = el.parentElement;
      const sotto = padre ? parseFloat(getComputedStyle(padre).paddingBottom) || 0 : 0;
      setHGuscio(Math.max(360, window.innerHeight - el.getBoundingClientRect().top - sotto));
    };
    misura();
    window.addEventListener("resize", misura);
    return () => window.removeEventListener("resize", misura);
  }, []);
  const video = useRef<HTMLVideoElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.videoShots().then((r) => setShots(r.shots)).catch(() => {});
  }, []);

  const scene = useMemo(() => raggruppa(shots), [shots]);
  const atti = useMemo(
    () => [...new Set(scene.map((s) => s.atto).filter(Boolean))] as string[],
    [scene],
  );

  const coda = useMemo(
    () =>
      scene.filter((s) => {
        if (atto && s.atto !== atto) return false;
        if (filtro === "da giudicare") return s.giudizio === null && !s.annotata;
        if (filtro === "tenute") return s.giudizio === "tenuta";
        if (filtro === "scartate") return s.giudizio === "scartata" || !s.kept;
        if (filtro === "annotate") return s.annotata;
        if (filtro === "in montaggio") return s.minuto !== null;
        return true;
      }),
    [scene, filtro, atto],
  );

  const scena = coda[Math.min(i, Math.max(0, coda.length - 1))] ?? null;
  const corrente = scena?.pezzi[Math.min(pezzo, scena.pezzi.length - 1)] ?? null;

  // Le generazioni si guardano solo mentre ce n'e' una viva: una scheda sola,
  // e un sondaggio a vuoto ogni tre secondi per tutta la sessione non serve.
  useEffect(() => {
    let vivo = true;
    const giro = async () => {
      try {
        const r = await api.videoGenerazioni();
        if (!vivo) return;
        setJobs(r.jobs);
        if (r.jobs.some((j) => j.status === "running" || j.status === "pending")) setTimeout(giro, 3000);
      } catch { /* il server puo' non essere un progetto video */ }
    };
    void giro();
    return () => { vivo = false; };
  }, [rigen]);

  useEffect(() => { setPezzo(0); }, [scena?.origine]);
  useEffect(() => { if (i >= coda.length) setI(Math.max(0, coda.length - 1)); }, [coda.length, i]);

  const avanti = useCallback(() => setI((k) => Math.min(k + 1, Math.max(0, coda.length - 1))), [coda.length]);

  /**
   * L'ultimo verdetto, con com'era prima.
   *
   * Si giudica a raffica con le frecce, quindi prima o poi si preme quella
   * sbagliata — e la scena e' gia' passata. Finche' l'unica traccia era una
   * riga in `scelte.json`, "ho scartato qualcosa per sbaglio?" era una domanda
   * a cui si poteva rispondere solo aprendo il file. Adesso l'ultimo resta
   * scritto in pagina, con il suo annulla, finche' non se ne fa un altro.
   */
  const [ultimo, setUltimo] = useState<
    { ids: string[]; nome: string; kept: boolean; prima: Map<string, boolean>; indice: number } | null
  >(null);

  const giudica = useCallback(
    async (kept: boolean, perche?: string) => {
      if (!scena) return;
      const ids = scena.pezzi.map((p) => p.id);
      const prima = new Map(scena.pezzi.map((p) => [p.id, p.kept]));
      // Ottimismo: la riga resta come l'utente l'ha messa anche se la rete tarda.
      setShots((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, kept } : s)));
      setUltimo({ ids, nome: scena.origine, kept, prima, indice: i });
      try {
        let u = shots;
        for (const id of ids) u = (await api.videoPick(id, kept, perche)).shots;
        setShots(u);
      } catch { /* la riga resta come l'utente l'ha messa */ }
      avanti();
    },
    [scena, shots, avanti, i],
  );

  /** Rimette ogni pezzo com'era e torna sulla scena, così la si può riguardare. */
  const disfaUltimo = useCallback(async () => {
    if (!ultimo) return;
    const u = ultimo;
    setUltimo(null);
    setShots((prev) => prev.map((s) => (u.prima.has(s.id) ? { ...s, kept: u.prima.get(s.id)! } : s)));
    try {
      let r = shots;
      for (const id of u.ids) r = (await api.videoPick(id, u.prima.get(id) ?? true)).shots;
      setShots(r);
    } catch { /* niente */ }
    setI(u.indice); setPezzo(0);
  }, [ultimo, shots]);

  const annota = useCallback(async () => {
    const t = testo.trim();
    setNota(null); setTesto("");
    if (!t || !scena) return;
    try { setShots((await api.videoProblema(scena.pezzi[0]!.id, t)).shots); } catch { /* niente */ }
  }, [testo, scena]);

  // Tastiera: le mani restano ferme e si giudica a raffica. Il campo nota e'
  // l'unico posto dove i tasti tornano a essere lettere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (nota !== null) {
        if (e.key === "Escape") { setNota(null); setTesto(""); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void annota();
        return;
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); setNota("scarto"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); void giudica(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setNota("nota"); }
      else if (e.key === "z") { e.preventDefault(); void disfaUltimo(); }
      else if (e.key === " ") { e.preventDefault(); const v = video.current; if (v) { v.currentTime = 0; void v.play(); } }
      else if (e.key === "ArrowDown") { e.preventDefault(); avanti(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nota, annota, giudica, avanti, disfaUltimo]);

  useEffect(() => { if (nota !== null) campo.current?.focus(); }, [nota]);

  const daGiudicare = scene.filter((s) => s.giudizio === null && !s.annotata).length;
  const tenute = scene.filter((s) => s.giudizio === "tenuta").length;
  const scartate = scene.filter((s) => s.giudizio === "scartata").length;

  return (
    <div ref={guscio} className="flex flex-col text-neutral-200 overflow-hidden" style={{ height: hGuscio }}>
      <div className="shrink-0 h-[24px] flex items-center gap-2.5 px-1 border-b border-neutral-900">
        <span className="tracking-[0.22em] text-[10.5px] text-neutral-400">SCELTA</span>
        <Link to={`/p/${pid}/video`} className="text-[11px] text-neutral-400 hover:text-neutral-200">
          ← montaggio
        </Link>
        <span className="text-[10.5px] text-neutral-400 tabular-nums">
          {coda.length} in coda · su {scene.length} prese:
          <span className="text-emerald-300"> {tenute} tenute</span> ·
          <span className="text-rose-300"> {scartate} scartate</span> ·
          <span className="text-neutral-100"> {daGiudicare} mai viste</span>
        </span>
        {ultimo && (
          <span className={`text-[10.5px] flex items-center gap-1.5 ${ultimo.kept ? "text-emerald-300" : "text-rose-300"}`}>
            {ultimo.kept ? "tenuta" : "scartata"} <span className="text-neutral-100">{ultimo.nome}</span>
            <button onClick={() => void disfaUltimo()}
                    className="px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
              annulla · z
            </button>
          </span>
        )}
        <div className="ml-auto flex gap-1.5 items-center">
        {(["da giudicare", "tenute", "scartate", "annotate", "in montaggio", "tutte"] as const).map((k) => (
          <button
            key={k}
            onClick={() => { setFiltro(k); setI(0); }}
            className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${
              filtro === k ? "border-neutral-500 text-neutral-200" : "border-neutral-900 text-neutral-400"
            }`}
          >
            {k}{k === "da giudicare" ? ` ${daGiudicare}` : ""}
          </button>
        ))}
        <select
          value={atto}
          onChange={(e) => { setAtto(e.target.value); setI(0); }}
          className="text-[10px] bg-neutral-950 border border-neutral-900 rounded-sm px-1 py-0.5 text-neutral-400"
        >
          <option value="">ogni atto</option>
          {atti.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        </div>
      </div>

      {!scena || !corrente ? (
        <div className="flex-1 min-h-0 grid place-items-center text-neutral-400 text-sm">
          {shots.length ? "niente da giudicare con questi filtri" : "nessuna ripresa nel progetto"}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex gap-3 pt-2 pb-1">
          <div className="shrink-0 flex flex-col">
            {/* La clip prende l'altezza che lo schermo ha. A 340px un verticale
                9:16 sta in 190 di larghezza: a quella misura un difetto si vede
                solo se e' enorme, e sono proprio i piccoli quelli che passano
                due volte prima che qualcuno se ne accorga. */}
            <video
              ref={video}
              key={corrente.id}
              src={pq(corrente.takes[0]?.clip ?? "")}
              poster={pq(corrente.takes[0]?.poster ?? "")}
              autoPlay muted loop playsInline
              className="flex-1 min-h-0 aspect-[9/16] bg-black border border-neutral-800 rounded-sm object-cover"
            />
            {scena.pezzi.length > 1 && (
              <div className="mt-2 flex gap-1.5">
                {scena.pezzi.map((p, k) => (
                  <button
                    key={p.id}
                    onClick={() => setPezzo(k)}
                    className={`text-[10.5px] px-1.5 py-0.5 rounded-sm border ${
                      k === pezzo ? "border-neutral-500 text-neutral-200" : "border-neutral-800 text-neutral-400"
                    }`}
                  >
                    {p.id}
                  </button>
                ))}
                <span className="text-[10.5px] text-neutral-400 self-center ml-1">
                  spezzoni della stessa presa
                </span>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-[15px] text-neutral-200">{scena.origine}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              <dt className="text-neutral-400">atto</dt>
              <dd>{scena.atto ?? <span className="text-neutral-400">— non in montaggio</span>}</dd>
              <dt className="text-neutral-400">in scena</dt>
              <dd>{scena.minuto === null ? "—" : `${scena.inScena.toFixed(1)}s a ${mmss(scena.minuto)}`}</dd>
              <dt className="text-neutral-400">durezza</dt>
              <dd className="tabular-nums">{corrente.durezza?.toFixed(2) ?? "—"}</dd>
              <dt className="text-neutral-400">stato</dt>
              <dd>
                {scena.giudizio === "tenuta"
                  ? <span className="text-emerald-300">
                      tenuta{scena.giudicataIl
                        ? ` il ${new Date(scena.giudicataIl).toLocaleString("it-IT",
                            { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                    </span>
                  : scena.giudizio === "scartata"
                  ? <span className="text-rose-300">scartata — {corrente.perche}</span>
                  : <span className="text-neutral-400">
                      mai giudicata{scena.kept ? " · sta nel montaggio perché tenere è il valore di partenza" : ""}
                    </span>}
                {scena.giudizio && (
                  <button
                    onClick={async () => {
                      for (const pz of scena.pezzi) setShots((await api.videoScordaGiudizio(pz.id)).shots);
                    }}
                    className="ml-2 px-1.5 py-0.5 rounded-sm border border-neutral-700 text-[10px]
                               text-neutral-400 hover:text-neutral-100">
                    scorda il voto
                  </button>
                )}
                {corrente.escluso && (
                  <span className="text-amber-500/80"> · esclusa dal piano: {corrente.escluso}</span>
                )}
              </dd>
            </dl>

            {corrente.problemi.length > 0 && (
              <ul className="mt-3 space-y-1">
                {corrente.problemi.map((p, k) => (
                  <li key={k} className="text-[11.5px] text-amber-400/90 flex gap-2">
                    <span>▸ {p}</span>
                    <button
                      className="text-neutral-400 hover:text-neutral-400"
                      onClick={async () => {
                        try { setShots((await api.videoProblema(corrente.id, undefined, k)).shots); } catch { /* niente */ }
                      }}
                    >
                      togli
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Il prompt e' il posto dove si corregge cio' che la nota dice.
                Finche' erano in due finestre diverse, il giro "questa si
                deforma" -> prompt nuovo -> generazione si chiudeva a mano. */}
            <details className="mt-3" open={rigen} onToggle={(e) => {
              const aperto = (e.currentTarget as HTMLDetailsElement).open;
              setRigen(aperto);
              if (aperto && !promptMod) setPromptMod(corrente.prompt ?? "");
            }}>
              <summary className="text-[11px] text-neutral-400 cursor-pointer">
                prompt e rigenerazione{corrente.prompt ? "" : " (nessun prompt registrato)"}
              </summary>
              <div className="mt-2 space-y-2">
                {corrente.problemi.length > 0 && (
                  <div className="text-[11px] text-amber-400/80 border-l-2 border-amber-500/40 pl-2">
                    {corrente.problemi.map((x, k) => <div key={k}>{x}</div>)}
                  </div>
                )}
                <textarea
                  value={promptMod}
                  onChange={(e) => setPromptMod(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full h-28 bg-neutral-950 border border-neutral-800 rounded-sm p-2 text-[11.5px] text-neutral-300 leading-relaxed"
                />
                {/* Non sono costanti nascoste: a 704x1280 con 81 fotogrammi la
                    3090 arriva a 23,9 GB su 24,5 e non scrive niente per un'ora.
                    Chi lancia deve poter vedere il numero che decide. */}
                <div className="flex gap-2 text-[11px]">
                  {(["width", "height", "length", "steps"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-1 text-neutral-400">
                      {k}
                      <input
                        type="number"
                        value={par[k]}
                        onChange={(e) => setPar({ ...par, [k]: Number(e.target.value) })}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="w-16 bg-neutral-950 border border-neutral-800 rounded-sm px-1 py-0.5 text-neutral-300"
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="px-2 py-0.5 rounded-sm border border-sky-700 text-sky-300 text-[11px] disabled:opacity-40"
                  disabled={!promptMod.trim() || jobs.some((j) => j.status === "running" || j.status === "pending")}
                  onClick={async () => {
                    try {
                      await api.videoGenera(corrente.id, promptMod, corrente.takes[0]?.take ?? "a", par);
                      setJobs((await api.videoGenerazioni()).jobs);
                    } catch (err) { alert(String(err)); }
                  }}
                >
                  rigenera sulla 3090
                </button>
                {jobs.filter((j) => j.piano === corrente.id).slice(0, 3).map((j) => (
                  <div key={j.id} className="text-[11px] text-neutral-400">
                    #{j.id} {j.status}
                    {j.frames ? ` — ${j.frames} fotogrammi` : ""}
                    {j.error && <span className="text-rose-400"> — {j.error}</span>}
                    {j.log && <pre className="mt-1 max-h-24 overflow-auto text-[10px] text-neutral-400 whitespace-pre-wrap">{j.log.split("\n").slice(-6).join("\n")}</pre>}
                  </div>
                ))}
              </div>
            </details>

            {nota !== null ? (
              <div className="mt-4">
                <textarea
                  ref={campo}
                  value={testo}
                  onChange={(e) => setTesto(e.target.value)}
                  placeholder={nota === "scarto" ? "perche' la scarti?" : "cosa c'e' da sistemare?"}
                  className="w-full h-20 bg-neutral-950 border border-neutral-800 rounded-sm p-2 text-[12px] text-neutral-200"
                />
                <div className="mt-1 flex gap-2 text-[11px]">
                  <button
                    className="px-2 py-0.5 rounded-sm border border-neutral-600 text-neutral-200"
                    onClick={async () => {
                      const t = testo;
                      if (nota === "scarto") { setNota(null); setTesto(""); await giudica(false, t); }
                      else await annota();
                    }}
                  >
                    {nota === "scarto" ? "scarta" : "annota"}
                  </button>
                  <button className="px-2 py-0.5 rounded-sm border border-neutral-800 text-neutral-400"
                          onClick={() => { setNota(null); setTesto(""); }}>
                    lascia stare
                  </button>
                  <span className="self-center text-neutral-400">⌘↵ conferma · esc annulla</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex gap-2 items-center">
                <button
                  onClick={() => setNota("scarto")}
                  className="px-4 py-1.5 rounded-sm border border-rose-800 text-rose-300 text-[13px]
                             hover:bg-rose-950/50"
                >
                  ✕ scarta
                </button>
                <button
                  onClick={() => void giudica(true)}
                  className="px-4 py-1.5 rounded-sm border border-emerald-800 text-emerald-300 text-[13px]
                             hover:bg-emerald-950/50"
                >
                  ♥ tieni
                </button>
                <button
                  onClick={() => setNota("nota")}
                  className="px-4 py-1.5 rounded-sm border border-neutral-800 text-neutral-400 text-[13px]
                             hover:border-neutral-600"
                >
                  ✎ annota
                </button>
                <span className="text-[11px] text-neutral-400 ml-2">
                  ← scarta · → tieni · ↑ annota · ↓ salta · spazio rivedi
                </span>
              </div>
            )}

            {/* Quanto manca, e cosa arriva. Un contatore "12 / 176" dice solo
                che la fine e' lontana; le facce dopo dicono se conviene tirare
                dritto o cambiare filtro, e il giudizio va a raffica per questo. */}
            <div className="mt-4 flex-1 min-h-0 flex flex-col">
              <div className="h-0.5 bg-neutral-900 rounded-full overflow-hidden">
                <div className="h-full bg-neutral-600"
                     style={{ width: `${coda.length ? ((i + 1) / coda.length) * 100 : 0}%` }} />
              </div>
              <div className="mt-1 text-[10.5px] text-neutral-400 tabular-nums shrink-0">
                {Math.min(i + 1, coda.length)} / {coda.length} · cosa arriva dopo
              </div>
              <div className="mt-3 grid gap-1.5"
                   style={{ gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))" }}>
                {coda.slice(i + 1, i + 61).map((sc, k) => {
                  const pr = sc.pezzi[0];
                  return (
                    <button
                      key={sc.origine}
                      onClick={() => { setI(i + 1 + k); setPezzo(0); }}
                      title={`${sc.origine}${sc.atto ? ` · ${sc.atto}` : ""}`}
                      className="w-full aspect-[9/16] rounded-sm border border-neutral-900 bg-cover bg-center
                                 opacity-45 hover:opacity-100 transition-opacity"
                      style={{ backgroundImage: pr?.takes[0]?.poster ? `url(${pq(pr.takes[0].poster)})` : undefined }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
