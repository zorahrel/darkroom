import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  lastProject,
  type ProjectKind,
  type StudioOverview,
  type StudioProject,
} from "../api";
import { Bott, Campo, Conferma, Interruttore, Targa, Testata } from "../ui";

/**
 * L'elenco dei progetti: il banco di lavoro da cui si entra.
 *
 * Ogni scheda risponde a tre domande nell'ordine in cui uno se le fa: che
 * roba è, a che punto sta, ci entro. Le azioni seguono lo stesso ordine di
 * peso — «Apri» è piena perché è il motivo per cui la pagina esiste; il
 * generatore è un interruttore perché è uno stato, non un comando; togliere un
 * progetto è quieto e chiede conferma, perché è l'unica cosa qui che non si
 * annulla da sola.
 */
export default function StudioPage() {
  const [data, setData] = useState<StudioOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  async function refresh() {
    try { setData(await api.studioProjects()); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  const predefinito = lastProject();
  const pausa = data?.worker.runner;

  return (
    <div className="space-y-4">
      <Testata titolo="Studio"
               sotto="Tutti i progetti su questa macchina. Quello col bordo verde è dove Darkroom si apre." />

      {err && (
        <div className="rounded border border-rose-900 bg-rose-950/40 text-rose-200 text-[12px] px-2.5 py-1.5">
          {err}
        </div>
      )}

      {pausa?.paused && pausa.paused_until && (
        <div className="rounded border border-amber-900 bg-amber-950/30 text-amber-200 text-[12px] px-2.5 py-1.5">
          La coda è ferma fino alle{" "}
          {new Date(pausa.paused_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          : fino a quell'ora nessun progetto genera niente.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
        {data?.projects.map((p) => (
          <Scheda
            key={p.id}
            p={p}
            predefinito={p.id === predefinito || (!predefinito && p === data.projects[0])}
            onApri={() => navigate(`/p/${p.id}`)}
            onGenera={async (v) => { await api.studioPatchProject(p.id, { active: v }); refresh(); }}
            onTogli={async () => { await api.studioRemoveProject(p.id); refresh(); }}
          />
        ))}
      </div>

      <Nuovo onFatto={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const TIPO: Record<ProjectKind, { targa: string; spiega: string }> = {
  photo: { targa: "foto", spiega: "Una galleria da rifinire: griglia, versioni, colore, esportazione." },
  storyboard: { targa: "storyboard", spiega: "Pannelli in sequenza da una scaletta, con durate e personaggi." },
  video: { targa: "video", spiega: "Un montaggio derivato dalle misure del brano: tagli sul beat, riprese scelte per durezza." },
};

const durataBreve = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)}s`;

function Scheda({
  p, predefinito, onApri, onGenera, onTogli,
}: {
  p: StudioProject;
  /** Aprendo Darkroom si entra qui. Non c'entra con `p.active`, che dice se il
   *  generatore lavora per questo progetto: due cose diverse che per un po' si
   *  sono chiamate tutt'e due "attivo". */
  predefinito: boolean;
  onApri: () => void;
  onGenera: (v: boolean) => void;
  onTogli: () => void;
}) {
  const s = p.stats;
  const q = s?.queue ?? {};
  const tipo = TIPO[p.kind] ?? TIPO.photo;

  const numeri = p.video
    ? [["tagli", p.video.tagli], ["riprese", p.video.piani], ["durata", durataBreve(p.video.durata)]] as const
    : s
      ? [["foto", s.photos], ["preferite", s.favorites], ["versioni", s.versions]] as const
      : null;

  return (
    <div className={`rounded-lg border bg-neutral-950/60 p-3 flex flex-col gap-2.5 ${
      predefinito ? "border-emerald-800" : "border-neutral-800"}`}>

      {/* riga 1: chi è */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[14px] font-medium truncate">{p.name}</span>
            <Targa titolo={tipo.spiega}>{tipo.targa}</Targa>
            {predefinito && (
              <Targa tono="buono" titolo="Aprendo Darkroom, o andando su /, si entra in questo progetto.">
                si apre qui
              </Targa>
            )}
          </div>
          <div className="text-[11px] text-neutral-400 truncate" title={p.root}>{p.root}</div>
        </div>
        <Conferma taglia="s"
                  titolo="Togli dall'elenco"
                  domanda={`Tolgo «${p.name}» dall'elenco? I file restano dove sono.`}
                  conferma="togli dall'elenco"
                  onConferma={onTogli}>
          ✕
        </Conferma>
      </div>

      {/* riga 2: gli allarmi, se ce ne sono */}
      {!p.root_exists && (
        <div className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900/60 rounded px-2 py-1">
          La cartella non c'è più: {p.root}
        </div>
      )}
      {p.error && (
        <div className="text-[11px] text-rose-200 bg-rose-950/30 border border-rose-900/60 rounded px-2 py-1 truncate"
             title={p.error}>
          {p.error}
        </div>
      )}

      {/* riga 3: a che punto sta */}
      {numeri && (
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {numeri.map(([etichetta, v]) => (
            <div key={etichetta} className="rounded bg-neutral-900/60 border border-neutral-800 py-1">
              <div className="text-[15px] font-semibold tabular-nums leading-tight">{v}</div>
              <div className="text-[10px] text-neutral-400">{etichetta}</div>
            </div>
          ))}
        </div>
      )}

      {/* riga 4: la coda. Altezza fissa: c'è solo su alcune schede, e senza,
          i bottoni «Apri» della stessa fila finivano a tre pixel di scarto. */}
      <div className="flex items-center gap-1.5 h-[20px] overflow-hidden text-[11px]">
        {(q.running ?? 0) > 0 && <Targa tono="info">{q.running} in corso</Targa>}
        {(q.pending ?? 0) > 0 && <Targa>{q.pending} in coda</Targa>}
        {(q.failed ?? 0) > 0 && (
          <Targa tono="male" titolo="Generazioni non riuscite. Si guardano e si nascondono dal pannello Lavori.">
            {q.failed} falliti
          </Targa>
        )}
        <span className="ml-auto text-neutral-400 shrink-0" title="ultima versione generata">
          {quando(s?.last_version_at ?? null)}
        </span>
      </div>

      {/* riga 5: cosa ci fai */}
      <div className="flex items-center gap-2">
        <Bott peso="primario" taglia="m" onClick={onApri} className="flex-1">Apri</Bott>
        <Interruttore acceso={p.active} onCambia={onGenera}
                      acceso_testo="genera" spento_testo="fermo"
                      titolo={p.active
                        ? "Il generatore prende i lavori di questo progetto. Clicca per fermarlo."
                        : "I lavori di questo progetto restano in coda. Clicca per farli partire."} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Nuovo({ onFatto }: { onFatto: () => void }) {
  const [aperto, setAperto] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<ProjectKind>("photo");
  const [foto, setFoto] = useState("");
  const [modo, setModo] = useState<"link" | "copy">("link");
  const [radice, setRadice] = useState("");
  const [avanzate, setAvanzate] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function crea() {
    setInCorso(true); setErr(null);
    try {
      const res = await api.studioAddProject({
        name: nome.trim(),
        kind: tipo,
        root: radice.trim() || undefined,
        photos: foto.trim() ? { path: foto.trim(), mode: modo } : undefined,
      });
      if (res.summary && res.summary.added === 0 && res.summary.scanned === 0) {
        setErr("Progetto creato, ma in quella cartella non ho trovato foto.");
      }
      setNome(""); setFoto(""); setRadice(""); setAvanzate(false); setAperto(false);
      onFatto();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setInCorso(false); }
  }

  if (!aperto) return <Bott taglia="m" onClick={() => setAperto(true)}>+ Nuovo progetto</Bott>;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 space-y-3 max-w-lg">
      <div className="text-[13px] font-medium">Nuovo progetto</div>

      <Riga etichetta="Come si chiama">
        <Campo valore={nome} onCambia={setNome} segnaposto="es. Kyoto 2026" autoFuoco
               taglia="m" className="w-full" onInvio={() => { if (nome.trim()) void crea(); }} />
      </Riga>

      <Riga etichetta="Che cosa ci fai">
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(TIPO) as ProjectKind[]).map((k) => (
            <Sceltona key={k} scelto={tipo === k} onClick={() => setTipo(k)}
                      titolo={TIPO[k].targa} nota={TIPO[k].spiega} />
          ))}
        </div>
      </Riga>

      {tipo === "photo" && (
        <Riga etichetta="Le foto — puoi aggiungerle anche dopo">
          <Campo valore={foto} onCambia={setFoto} segnaposto="/Users/…/Foto/Kyoto"
                 taglia="m" className="w-full font-mono" />
          {foto.trim() && (
            <div className="grid grid-cols-2 gap-1.5 pt-1.5">
              <Sceltona scelto={modo === "link"} onClick={() => setModo("link")}
                        titolo="Lasciale dove sono" nota="Le indicizzo sul posto: non copio niente." />
              <Sceltona scelto={modo === "copy"} onClick={() => setModo("copy")}
                        titolo="Copiale nel progetto" nota="Utile se la cartella è temporanea." />
            </div>
          )}
        </Riga>
      )}

      <div>
        <Bott peso="quieto" taglia="s" onClick={() => setAvanzate((v) => !v)}>
          {avanzate ? "▾" : "▸"} Dove salvare il progetto
        </Bott>
        {avanzate && (
          <div className="pt-1.5">
            <Riga etichetta="Cartella del progetto — vuoto: la crea Darkroom">
              <Campo valore={radice} onCambia={setRadice} taglia="m"
                     segnaposto="~/Darkroom/projects/<nome>" className="w-full font-mono" />
            </Riga>
          </div>
        )}
      </div>

      {err && <div className="text-[11px] text-amber-300">{err}</div>}

      <div className="flex items-center gap-1.5">
        <Bott peso="primario" taglia="m" onClick={crea} disabilitato={inCorso || !nome.trim()}>
          {inCorso ? "Creo…" : "Crea"}
        </Bott>
        <Bott peso="quieto" taglia="m" onClick={() => setAperto(false)}>Annulla</Bott>
      </div>
    </div>
  );
}

function Sceltona({ scelto, onClick, titolo, nota }: {
  scelto: boolean; onClick: () => void; titolo: string; nota: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={scelto}
            className={`text-left p-2 rounded border transition-colors ${
              scelto ? "border-emerald-700 bg-emerald-950/30" : "border-neutral-800 hover:border-neutral-600"}`}>
      <div className="text-[12px] text-neutral-100">{titolo}</div>
      <div className="text-[11px] text-neutral-400 leading-snug mt-0.5">{nota}</div>
    </button>
  );
}

function Riga({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-neutral-400">{etichetta}</span>
      {children}
    </label>
  );
}

function quando(ms: number | null): string {
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min}m fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h fa`;
  return `${Math.round(h / 24)}g fa`;
}
