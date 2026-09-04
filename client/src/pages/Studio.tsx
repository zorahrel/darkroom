import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,

  type ProjectKind,
  type StudioOverview,
  type StudioProject,
} from "../api";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Altro, Bott, Campo, Cerca, Conferma, Filtro, Targa, Testata, useChiudiMenu } from "../ui";
import { VISTE, vista } from "../viste";

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
/** Come si guarda l'elenco: per cosa sa fare un progetto, o per come sta. */
type Stato = "tutti" | "in_corso" | "falliti" | "pausa" | "rotti";
type Ordine = "recenti" | "nome" | "grandi";

export default function StudioPage() {
  const [data, setData] = useState<StudioOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [vista, setVista] = useState<ProjectKind | "tutte">("tutte");
  const [stato, setStato] = useState<Stato>("tutti");
  const [ordine, setOrdine] = useState<Ordine>("recenti");
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

  const pausa = data?.worker.runner;
  const tutti = data?.projects ?? [];

  /** Quanti progetti cadrebbero in ogni filtro. Un filtro senza numero non
   *  dice se vale la pena aprirlo, e a zero si spegne da solo. */
  const conta = useMemo(() => {
    const q = (f: (p: StudioProject) => boolean) => tutti.filter(f).length;
    return {
      tutte: tutti.length,
      photo: q((p) => p.views.includes("photo")),
      storyboard: q((p) => p.views.includes("storyboard")),
      video: q((p) => p.views.includes("video")),
      tutti: tutti.length,
      in_corso: q((p) => ((p.stats?.queue?.running ?? 0) + (p.stats?.queue?.pending ?? 0)) > 0),
      falliti: q((p) => (p.stats?.queue?.failed ?? 0) > 0),
      pausa: q((p) => !p.active),
      rotti: q((p) => !p.root_exists || !!p.error),
    };
  }, [tutti]);

  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    const dentro = tutti.filter((p) => {
      if (vista !== "tutte" && !p.views.includes(vista)) return false;
      if (stato === "in_corso" && ((p.stats?.queue?.running ?? 0) + (p.stats?.queue?.pending ?? 0)) === 0) return false;
      if (stato === "falliti" && (p.stats?.queue?.failed ?? 0) === 0) return false;
      if (stato === "pausa" && p.active) return false;
      if (stato === "rotti" && p.root_exists && !p.error) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q) || p.id.includes(q);
    });
    const peso = (p: StudioProject) => p.stats?.photos ?? p.video?.tagli ?? 0;
    return dentro.sort((a, b) =>
      ordine === "nome"
        ? a.name.localeCompare(b.name)
        : ordine === "grandi"
          ? peso(b) - peso(a)
          // "Recenti" è l'ultima versione generata, non la data di creazione:
          // il progetto su cui si stava lavorando è quello che ha prodotto
          // qualcosa per ultimo, non quello aperto per ultimo.
          : (b.stats?.last_version_at ?? b.created_at) - (a.stats?.last_version_at ?? a.created_at),
    );
  }, [tutti, cerca, vista, stato, ordine]);

  return (
    <div className="space-y-4">
      <Testata titolo="Progetti"
               sotto="Tutti i progetti su questa macchina. Le viste accese dicono cosa sa fare ognuno: si accendono e si spengono da qui." />

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

      {/* La barra dei filtri: prima COSA sa fare un progetto, poi COME sta.
          Due domande diverse, quindi due gruppi, non un elenco unico in cui
          «video» e «in pausa» si escludono a vicenda senza motivo. */}
      <div className="flex flex-wrap items-center gap-2 border-y border-neutral-800 py-2">
        <Cerca valore={cerca} onCambia={setCerca} segnaposto="cerca un progetto…" />
        <div className="flex items-center gap-1">
          <Filtro attiva={vista === "tutte"} onClick={() => setVista("tutte")} n={conta.tutte}>tutti</Filtro>
          {VISTE.map((v) => (
            <Filtro key={v.id} attiva={vista === v.id} onClick={() => setVista(v.id)}
                    n={conta[v.id]} titolo={v.spiega}>
              {v.nome}
            </Filtro>
          ))}
        </div>
        <span className="w-px h-4 bg-neutral-800" aria-hidden />
        <div className="flex items-center gap-1">
          <Filtro attiva={stato === "in_corso"} onClick={() => setStato(stato === "in_corso" ? "tutti" : "in_corso")}
                  n={conta.in_corso} titolo="Hanno lavori in coda o in corso">in corso</Filtro>
          <Filtro attiva={stato === "falliti"} onClick={() => setStato(stato === "falliti" ? "tutti" : "falliti")}
                  n={conta.falliti} titolo="Hanno generazioni fallite da guardare">falliti</Filtro>
          <Filtro attiva={stato === "pausa"} onClick={() => setStato(stato === "pausa" ? "tutti" : "pausa")}
                  n={conta.pausa} titolo="Il generatore li salta">in pausa</Filtro>
          <Filtro attiva={stato === "rotti"} onClick={() => setStato(stato === "rotti" ? "tutti" : "rotti")}
                  n={conta.rotti} titolo="Cartella sparita o database che non si apre">da sistemare</Filtro>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-neutral-400">
          ordina
          {([["recenti", "recenti"], ["nome", "nome"], ["grandi", "più grandi"]] as const).map(([id, testo]) => (
            <button key={id} type="button" onClick={() => setOrdine(id)} aria-pressed={ordine === id}
                    className={"px-1.5 py-0.5 rounded-sm border transition-colors " +
                      (ordine === id ? "border-neutral-300 text-neutral-100" : "border-transparent hover:text-neutral-200")}>
              {testo}
            </button>
          ))}
        </div>
      </div>

      {data && visibili.length === 0 && (
        <div className="text-[12px] text-neutral-400">
          {tutti.length === 0
            ? "Nessun progetto ancora: cominciane uno qui sotto, o dagli strumenti."
            : "Niente con questi filtri. "}
          {tutti.length > 0 && (
            <button className="underline hover:text-neutral-100"
                    onClick={() => { setCerca(""); setVista("tutte"); setStato("tutti"); }}>
              Rimettili a posto
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
        {visibili.map((p) => (
          <Scheda
            key={p.id}
            p={p}
            onApri={() => navigate(`/p/${p.id}`)}
            onGenera={async (v) => { await api.studioPatchProject(p.id, { active: v }); refresh(); }}
            onViste={async (v) => { await api.studioPatchProject(p.id, { views: v }); refresh(); }}
            onTogli={async () => { await api.studioRemoveProject(p.id); refresh(); }}
          />
        ))}
      </div>

      <Nuovo onFatto={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const durataBreve = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)}s`;

function Scheda({
  p, onApri, onGenera, onViste, onTogli,
}: {
  p: StudioProject;
  onApri: () => void;
  onGenera: (v: boolean) => void;
  onViste: (v: ProjectKind[]) => void;
  onTogli: () => void;
}) {
  const s = p.stats;
  const q = s?.queue ?? {};
  const principale = vista(p.kind);
  const Icona = principale.icona;

  const numeri = p.video
    ? [["tagli", p.video.tagli], ["riprese", p.video.piani], ["durata", durataBreve(p.video.durata)]] as const
    : s
      ? [["foto", s.photos], ["preferite", s.favorites], ["versioni", s.versions]] as const
      : null;

  /** Accendere e spegnere una vista. La principale non si spegne: sarebbe un
   *  progetto che si apre su una pagina che non c'è. */
  const cambiaVista = (id: ProjectKind) => {
    if (id === p.kind) return;
    const dentro = new Set(p.views);
    if (dentro.has(id)) dentro.delete(id); else dentro.add(id);
    onViste([...dentro]);
  };

  return (
    // La scheda intera è il tasto per entrare: il rettangolo bianco su ogni
    // riquadro gridava più forte del nome del progetto, e la cosa che si vuole
    // cliccare è il progetto, non un bottone dentro il progetto.
    <div className="group relative rounded-lg border border-neutral-800 bg-neutral-950/60 p-3
                    flex flex-col gap-2.5 transition-colors hover:border-neutral-600">
      <button type="button" onClick={onApri} aria-label={`Apri ${p.name}`}
              className="absolute inset-0 z-0 rounded-lg focus-visible:outline focus-visible:outline-1
                         focus-visible:outline-offset-2 focus-visible:outline-neutral-300" />

      <div className="relative z-20 flex items-start gap-2 min-w-0 pointer-events-none">
        <Icona className="w-4 h-4 mt-[3px] shrink-0 text-neutral-400" aria-hidden />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[14px] font-medium truncate group-hover:text-white">{p.name}</span>
          </div>
          <div className="text-[11px] text-neutral-400 truncate" title={p.root}>{p.root}</div>
        </div>
        {/* Compare passandoci sopra, e resta se ci si arriva col tasto di
            tabulazione: nascosto non vuol dire irraggiungibile. */}
        <Altro discreto className="pointer-events-auto">
          <VoceMenu onClick={onApri}>Apri il progetto</VoceMenu>
          <VoceMenu onClick={() => navigator.clipboard?.writeText(p.root)}>Copia il percorso</VoceMenu>
          <VoceMenu onClick={() => onGenera(!p.active)}
                    nota="Il generatore è uno solo per tutti i progetti. Mettendo in pausa questo, i suoi lavori restano in coda e passano avanti gli altri.">
            {p.active ? "Metti in pausa" : "Rimetti in lavorazione"}
          </VoceMenu>
          <div className="border-t border-neutral-800 my-1" />
          <Conferma taglia="s" className="w-full justify-start"
                    domanda={`Tolgo «${p.name}»? I file restano dove sono.`}
                    conferma="togli" onConferma={onTogli}>
            Togli dall'elenco
          </Conferma>
        </Altro>
      </div>

      {!p.root_exists && (
        <div className="relative z-10 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900/60
                        rounded px-2 py-1 pointer-events-none">
          La cartella non c'è più: {p.root}
        </div>
      )}
      {p.error && (
        <div className="relative z-10 text-[11px] text-rose-200 bg-rose-950/30 border border-rose-900/60
                        rounded px-2 py-1 truncate pointer-events-none" title={p.error}>
          {p.error}
        </div>
      )}

      {numeri && (
        <div className="relative z-10 grid grid-cols-3 gap-1.5 text-center pointer-events-none">
          {numeri.map(([etichetta, v]) => (
            <div key={etichetta} className="rounded bg-neutral-900/60 border border-neutral-800 py-1">
              <div className="text-[15px] font-semibold tabular-nums leading-tight">{v}</div>
              <div className="text-[10px] text-neutral-400">{etichetta}</div>
            </div>
          ))}
        </div>
      )}

      {/* Che cosa sa fare questo progetto. Si accendono e si spengono da qui:
          un lavoro comincia con delle foto e finisce in un montaggio, e non
          deve diventare due progetti sulla stessa cartella. */}
      <div className="relative z-10 flex flex-wrap items-center gap-1"
           title="Le viste di questo progetto: accendile e spegnile da qui.">
        {VISTE.map((v) => {
          const accesa = p.views.includes(v.id);
          const fissa = v.id === p.kind;
          const I = v.icona;
          return (
            <button key={v.id} type="button" disabled={fissa}
                    onClick={(e) => { e.stopPropagation(); cambiaVista(v.id); }}
                    title={fissa
                      ? `${v.spiega} È la vista principale: si apre qui, quindi non si spegne.`
                      : accesa ? `${v.spiega} Clicca per spegnerla.` : `${v.spiega} Clicca per accenderla.`}
                    className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-[2px] text-[10.5px]
                                transition-colors ${
                      !accesa ? "border-dashed border-neutral-700 text-neutral-400 hover:border-solid hover:border-neutral-500 hover:text-neutral-200"
                      : fissa ? "border-neutral-500 bg-neutral-800 text-neutral-100 cursor-default"
                      : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-500"}`}>
              <I className="w-3 h-3" aria-hidden />
              {v.nome}
            </button>
          );
        })}
      </div>

      {/* Altezza fissa: questa riga c'è solo su alcune schede, e senza, i piedi
          delle schede della stessa fila finivano a tre pixel di scarto. */}
      <div className="relative z-10 flex items-center gap-1.5 h-[20px] overflow-hidden text-[11px]
                      pointer-events-none">
        {(q.running ?? 0) > 0 && <Targa tono="info">{q.running} in corso</Targa>}
        {(q.pending ?? 0) > 0 && <Targa>{q.pending} in coda</Targa>}
        {(q.failed ?? 0) > 0 && (
          <Targa tono="male" titolo="Generazioni non riuscite. Si guardano e si nascondono dal pannello Lavori.">
            {q.failed} falliti
          </Targa>
        )}
        {/* Lo stato normale non si scrive: si vede che non c'è niente di
            strano. In pausa invece è un'eccezione — i lavori ci sono e nessuno
            li tocca — e quella va detta. */}
        {!p.active && (
          <Targa tono="attesa" titolo="Il generatore salta questo progetto: i suoi lavori restano in coda finché non lo rimetti in lavorazione (menu ⋯).">
            in pausa
          </Targa>
        )}
        <span className="ml-auto text-neutral-400 shrink-0" title="ultima versione generata">
          {quando(s?.last_version_at ?? null)}
        </span>
        <span className="text-neutral-400 group-hover:text-neutral-100 transition-colors
                         inline-flex items-center gap-1 shrink-0">
          apri <ArrowRight className="w-3 h-3" aria-hidden />
        </span>
      </div>

    </div>
  );
}

function VoceMenu({ children, onClick, nota }: {
  children: React.ReactNode; onClick: () => void; nota?: string;
}) {
  const chiudi = useChiudiMenu();
  return (
    <button type="button" role="menuitem" title={nota}
            onClick={(e) => { e.stopPropagation(); onClick(); chiudi(); }}
            className="w-full text-left px-2 py-1 rounded-sm text-[11px] text-neutral-300
                       hover:bg-neutral-800 hover:text-neutral-100">
      {children}
      {nota && <span className="block text-[10.5px] text-neutral-400 leading-snug mt-0.5">{nota}</span>}
    </button>
  );
}

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
          {VISTE.map((v) => (
            <Sceltona key={v.id} scelto={tipo === v.id} onClick={() => setTipo(v.id)}
                      icona={v.icona} titolo={v.nome} nota={v.spiega} />
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

function Sceltona({ scelto, onClick, titolo, nota, icona: I }: {
  scelto: boolean; onClick: () => void; titolo: string; nota: string; icona?: LucideIcon;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={scelto}
            className={`text-left p-2 rounded border transition-colors ${
              scelto ? "border-emerald-700 bg-emerald-950/30" : "border-neutral-800 hover:border-neutral-600"}`}>
      <div className="text-[12px] text-neutral-100 flex items-center gap-1.5">
        {I && <I className="w-3.5 h-3.5 text-neutral-400" aria-hidden />}
        {titolo}
      </div>
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
