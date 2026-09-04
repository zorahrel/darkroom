import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  lastProject,
  type AreaStrumento,
  type Avvio,
  type CampoAvvio,
  type Catalogo,
  type Strumento,
  type StudioProject,
} from "../api";
import { Area, Bott, Campo, Cerca, Filtro, Numero, Scegli, Targa, Testata } from "../ui";
import { ICONE } from "../icone";
import { ArrowRight, Wrench } from "lucide-react";

/**
 * La home: cosa sa fare Darkroom, e come cominciare.
 *
 * Prima l'ingresso era un redirect all'ultimo progetto aperto. Comodo per chi
 * ci lavorava ogni giorno, e muto per chiunque altro: un programma che sa fare
 * ventun mestieri si apriva su una griglia di foto senza dire da nessuna parte
 * che sotto c'era anche il montaggio, i controlli qualità, lo storyboard. Le
 * capacità esistevano e non si trovavano — che, dal di fuori, è lo stesso che
 * non averle.
 *
 * Qui ogni strumento dice tre cose e nell'ordine in cui uno se le chiede: cosa
 * fa, se funziona ADESSO su questa macchina (e se no, cosa manca), e come si
 * comincia — dentro un progetto che c'è già, facendone uno nuovo, o subito.
 * L'elenco non è scritto qui: arriva dal catalogo del server, lo stesso che
 * risponde all'MCP. Una capacità nuova compare qui il giorno in cui esiste,
 * senza che nessuno si ricordi di aggiungerla anche alla home.
 */
export default function Home() {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [progetti, setProgetti] = useState<StudioProject[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [area, setArea] = useState<AreaStrumento | "tutte">("tutte");
  const [soloPronti, setSoloPronti] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.strumenti().then(setCat).catch((e) => setErr(String(e?.message ?? e)));
    api.studioProjects().then((r) => setProgetti(r.projects)).catch(() => {});
  }, []);

  const conteggi = useMemo(() => {
    const c: Record<string, number> = { tutte: cat?.strumenti.length ?? 0 };
    for (const s of cat?.strumenti ?? []) c[s.area] = (c[s.area] ?? 0) + 1;
    return c;
  }, [cat]);

  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return (cat?.strumenti ?? []).filter((s) => {
      if (area !== "tutte" && s.area !== area) return false;
      if (soloPronti && !s.pronto) return false;
      if (!q) return true;
      // Si cerca anche fra i nomi MCP: chi arriva dalla chat conosce quelli,
      // non i nomi che abbiamo dato ai mestieri.
      return (
        s.nome.toLowerCase().includes(q) ||
        s.cosa.toLowerCase().includes(q) ||
        s.id.includes(q) ||
        s.mcp.some((m) => m.includes(q))
      );
    });
  }, [cat, cerca, area, soloPronti]);

  const ultimo = lastProject();
  const recenti = useMemo(() => {
    const ord = [...progetti].sort(
      (a, b) =>
        (b.id === ultimo ? 1 : 0) - (a.id === ultimo ? 1 : 0) ||
        (b.stats?.last_version_at ?? b.created_at) - (a.stats?.last_version_at ?? a.created_at),
    );
    return ord.slice(0, 4);
  }, [progetti, ultimo]);

  const spenti = (cat?.strumenti ?? []).filter((s) => !s.pronto).length;

  return (
    <div className="space-y-5 pb-10">
      <Testata
        titolo="Strumenti"
        sotto="Tutto quello che Darkroom sa fare, con come si comincia. Lo stesso elenco che vede Claude via MCP."
      >
        <Link
          to="/studio"
          className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 hover:text-neutral-100"
        >
          {progetti.length} {progetti.length === 1 ? "progetto" : "progetti"}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden />
        </Link>
      </Testata>

      {err && (
        <div className="rounded border border-rose-900 bg-rose-950/40 text-rose-200 text-[12px] px-2.5 py-1.5">
          Il catalogo non risponde: {err}
        </div>
      )}

      {/* Riprendere è la cosa che si fa più spesso, quindi sta prima di
          tutto. Era un redirect automatico: comodo per chi torna, e un muro
          per chi arriva. Qui è un clic, e il resto della casa resta in vista. */}
      {recenti.length > 0 && (
        <section className="space-y-1.5">
          <h2 className="text-[11px] uppercase tracking-wide text-neutral-400">Riprendi</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {recenti.map((p) => (
              <SchedaProgetto key={p.id} p={p} ultimo={p.id === ultimo} />
            ))}
          </div>
        </section>
      )}

      {/* La barra dei filtri. Le pastiglie contano, perché un filtro senza
          numero non dice se vale la pena aprirlo. */}
      <div className="sticky top-[var(--h-testata,57px)] z-20 -mx-4 px-4 py-2 bg-neutral-950/90 backdrop-blur
                      border-y border-neutral-800 flex flex-wrap items-center gap-2">
        <Cerca valore={cerca} onCambia={setCerca} segnaposto="cerca uno strumento…" />
        <div className="flex items-center gap-1 flex-wrap">
          <Filtro attiva={area === "tutte"} onClick={() => setArea("tutte")} n={conteggi.tutte ?? 0}>
            tutti
          </Filtro>
          {cat?.aree.map((a) => (
            <Filtro
              key={a.id}
              attiva={area === a.id}
              onClick={() => setArea(a.id)}
              n={conteggi[a.id] ?? 0}
              titolo={a.cosa}
            >
              {a.nome}
            </Filtro>
          ))}
        </div>
        <Bott
          taglia="m"
          peso="quieto"
          attivo={soloPronti}
          onClick={() => setSoloPronti((v) => !v)}
          titolo={
            spenti
              ? `${spenti} strumenti non sono usabili adesso: manca qualcosa sulla macchina.`
              : "Tutti gli strumenti sono usabili adesso."
          }
        >
          solo pronti
          {spenti > 0 && <span className="ml-1 text-amber-400 tabular-nums">{cat!.strumenti.length - spenti}</span>}
        </Bott>
        {cat && (
          <div className="ml-auto flex items-center gap-1.5">
            {Object.entries(cat.requisiti).map(([nome, r]) => (
              <Targa key={nome} tono={r.ok ? "buono" : "attesa"} titolo={r.come}>
                {r.ok ? "●" : "○"} {nome}
              </Targa>
            ))}
          </div>
        )}
      </div>

      {!cat && <div className="text-[12px] text-neutral-400">Carico il catalogo…</div>}

      {cat && visibili.length === 0 && (
        <div className="text-[12px] text-neutral-400">
          Niente con questi filtri.{" "}
          <button className="underline hover:text-neutral-100" onClick={() => { setCerca(""); setArea("tutte"); setSoloPronti(false); }}>
            Rimettili a posto
          </button>
          .
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
        {visibili.map((s) => (
          <SchedaStrumento
            key={s.id}
            s={s}
            progetti={progetti}
            ultimo={ultimo}
            onFatto={(rotta) => navigate(rotta)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SchedaProgetto({ p, ultimo }: { p: StudioProject; ultimo: boolean }) {
  const I = ICONE[p.kind === "video" ? "film" : p.kind === "storyboard" ? "clapper" : "images"] ?? Wrench;
  const n = p.video
    ? `${p.video.tagli} tagli`
    : p.stats
      ? `${p.stats.photos} foto · ${p.stats.favorites} preferite`
      : "";
  return (
    <Link
      to={`/p/${encodeURIComponent(p.id)}`}
      className="group rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2.5 flex items-center gap-2.5
                 hover:border-neutral-600 transition-colors"
    >
      <I className="w-4 h-4 shrink-0 text-neutral-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] truncate group-hover:text-white">{p.name}</div>
        <div className="text-[11px] text-neutral-400 truncate">{n}</div>
      </div>
      {ultimo && <Targa tono="info">ultimo</Targa>}
      <ArrowRight className="w-3.5 h-3.5 text-neutral-500 group-hover:text-neutral-100 shrink-0" aria-hidden />
    </Link>
  );
}

/**
 * Uno strumento, con le sue vie d'ingresso.
 *
 * Le azioni non sono decorative: «apri» porta dentro un progetto che esiste
 * già, «nuovo» ne fa uno acceso sulla vista giusta, «subito» fa la cosa. Il
 * modulo che si apre sotto è generato dai campi che il catalogo dichiara —
 * così un campo nuovo lato server compare qui senza toccare questo file.
 */
function SchedaStrumento({
  s, progetti, ultimo, onFatto,
}: {
  s: Strumento;
  progetti: StudioProject[];
  ultimo: string | null;
  onFatto: (rotta: string) => void;
}) {
  const [aperto, setAperto] = useState<Avvio | null>(null);
  const I = ICONE[s.icona] ?? Wrench;

  /** I progetti che questo strumento può servire: quelli con la vista accesa. */
  const compatibili = progetti.filter(
    (p) => s.viste.length === 0 || s.viste.some((v) => p.views.includes(v)),
  );

  return (
    <div
      className={
        "rounded-lg border bg-neutral-950/60 p-3 space-y-2.5 transition-colors " +
        (s.pronto ? "border-neutral-800 hover:border-neutral-600" : "border-neutral-800/60")
      }
    >
      <div className="flex items-start gap-2.5">
        <I className={"w-4 h-4 mt-[3px] shrink-0 " + (s.pronto ? "text-neutral-300" : "text-neutral-500")} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={"text-[14px] font-medium " + (s.pronto ? "" : "text-neutral-400")}>{s.nome}</span>
            {s.mcp.length > 0 && (
              <Targa titolo={`Da Claude: ${s.mcp.join(", ")}`}>mcp ×{s.mcp.length}</Targa>
            )}
          </div>
          <p className="text-[12px] text-neutral-400 leading-snug">{s.cosa}</p>
        </div>
      </div>

      {/* Non pronto non è «rotto»: è una cosa che manca, con il gesto che la
          sistema. Uno strumento grigio senza spiegazione è una porta chiusa. */}
      {!s.pronto && (
        <div className="rounded border border-amber-900/60 bg-amber-950/20 px-2 py-1.5 space-y-0.5">
          {s.manca.map((m) => (
            <div key={m.requisito} className="text-[11px] text-amber-200/90 leading-snug">
              {m.come}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {s.avvii.map((a, i) =>
          a.modo === "apri" ? (
            <ApriDove key={i} avvio={a} progetti={compatibili} ultimo={ultimo} onVai={onFatto} />
          ) : (
            <Bott
              key={i}
              taglia="m"
              peso={i === 0 ? "primario" : "normale"}
              disabilitato={!s.pronto}
              titolo={s.pronto ? a.nota : s.manca[0]?.come}
              onClick={() => setAperto(aperto === a ? null : a)}
            >
              {a.etichetta}
            </Bott>
          ),
        )}
        {s.avvii.length === 0 && (
          <span className="text-[11px] text-neutral-500">Si guarda dal pannello Lavori, in alto.</span>
        )}
      </div>

      {aperto && aperto.modo !== "apri" && (
        <Modulo
          strumento={s}
          avvio={aperto}
          progetti={compatibili}
          ultimo={ultimo}
          onAnnulla={() => setAperto(null)}
          onFatto={onFatto}
        />
      )}
    </div>
  );
}

/** «Apri»: in quale progetto? Con uno solo si entra e basta. */
function ApriDove({
  avvio, progetti, ultimo, onVai,
}: {
  avvio: Extract<Avvio, { modo: "apri" }>;
  progetti: StudioProject[];
  ultimo: string | null;
  onVai: (rotta: string) => void;
}) {
  const [pid, setPid] = useState(
    () => (ultimo && progetti.some((p) => p.id === ultimo) ? ultimo : progetti[0]?.id) ?? "",
  );
  if (progetti.length === 0) {
    return (
      <span className="text-[11px] text-neutral-500">
        Nessun progetto con la vista «{avvio.vista}»: fanne uno qui sopra.
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Bott taglia="m" onClick={() => onVai(avvio.rotta.replace(":pid", encodeURIComponent(pid)))}>
        {avvio.etichetta}
      </Bott>
      {progetti.length > 1 && (
        <Scegli
          valore={pid}
          voci={progetti.map((p) => ({ v: p.id, testo: p.name }))}
          onCambia={setPid}
          larghezza={140}
          taglia="m"
          titolo="In quale progetto"
        />
      )}
    </div>
  );
}

/**
 * Il modulo d'avvio, costruito dai campi che il catalogo dichiara.
 *
 * Un modulo scritto a mano per strumento sarebbe stato ventun moduli da
 * tenere allineati a ventuno handler: il primo campo aggiunto lato server
 * sarebbe rimasto invisibile qui, e nessuno se ne sarebbe accorto.
 */
function Modulo({
  strumento, avvio, progetti, ultimo, onAnnulla, onFatto,
}: {
  strumento: Strumento;
  avvio: Extract<Avvio, { modo: "nuovo" | "subito" }>;
  progetti: StudioProject[];
  ultimo: string | null;
  onAnnulla: () => void;
  onFatto: (rotta: string) => void;
}) {
  const [valori, setValori] = useState<Record<string, string | number>>(() =>
    Object.fromEntries(avvio.campi.map((c) => [c.nome, c.predefinito ?? ""])),
  );
  const [pid, setPid] = useState(
    () => (ultimo && progetti.some((p) => p.id === ultimo) ? ultimo : progetti[0]?.id) ?? "",
  );
  const [inCorso, setInCorso] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fatto, setFatto] = useState<{ testo: string; rotta: string } | null>(null);

  const mancante = avvio.campi.find((c) => c.richiesto && !String(valori[c.nome] ?? "").trim());

  async function vai() {
    setInCorso(true);
    setErr(null);
    try {
      const r = await api.avviaStrumento(strumento.id, {
        // Un avvio che CREA il progetto non ne riceve uno: mandarglielo
        // sarebbe un'istruzione che non guarda nessuno.
        progetto: avvio.modo === "subito" ? pid || undefined : undefined,
        valori,
      });
      setFatto({ testo: r.fatto, rotta: r.rotta });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  }

  if (fatto) {
    return (
      <div className="rounded border border-emerald-900/70 bg-emerald-950/20 p-2.5 space-y-2">
        <div className="text-[12px] text-emerald-200 leading-snug">{fatto.testo}</div>
        <div className="flex items-center gap-1.5">
          <Bott taglia="m" peso="primario" onClick={() => onFatto(fatto.rotta)}>
            Vai a vedere
          </Bott>
          <Bott taglia="m" peso="quieto" onClick={onAnnulla}>Resta qui</Bott>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 p-2.5 space-y-2">
      {avvio.nota && <p className="text-[11px] text-neutral-400 leading-snug">{avvio.nota}</p>}

      {avvio.modo === "subito" && progetti.length > 0 && (
        <label className="block space-y-1">
          <span className="text-[11px] text-neutral-400">Su quale progetto</span>
          <Scegli
            valore={pid}
            voci={progetti.map((p) => ({ v: p.id, testo: p.name }))}
            onCambia={setPid}
            larghezza={200}
            taglia="m"
          />
        </label>
      )}

      {avvio.campi.map((c) => (
        <CampoDiAvvio
          key={c.nome}
          campo={c}
          valore={valori[c.nome] ?? ""}
          onCambia={(v) => setValori((x) => ({ ...x, [c.nome]: v }))}
          onInvia={() => { if (!mancante) void vai(); }}
        />
      ))}

      {err && <div className="text-[11px] text-amber-300 leading-snug">{err}</div>}

      <div className="flex items-center gap-1.5">
        <Bott
          taglia="m"
          peso="primario"
          disabilitato={inCorso || !!mancante}
          titolo={mancante ? `Manca: ${mancante.etichetta}` : undefined}
          onClick={vai}
        >
          {inCorso ? "Vado…" : avvio.etichetta}
        </Bott>
        <Bott taglia="m" peso="quieto" onClick={onAnnulla}>Annulla</Bott>
      </div>
    </div>
  );
}

function CampoDiAvvio({
  campo, valore, onCambia, onInvia,
}: {
  campo: CampoAvvio;
  valore: string | number;
  onCambia: (v: string | number) => void;
  onInvia: () => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-neutral-400">
        {campo.etichetta}
        {campo.richiesto && <span className="text-neutral-600"> *</span>}
      </span>
      {campo.tipo === "lungo" ? (
        <Area
          valore={String(valore)}
          onCambia={onCambia}
          segnaposto={campo.segnaposto}
          onInvia={onInvia}
          className="text-[12px] h-20"
        />
      ) : campo.tipo === "numero" ? (
        <Numero valore={Number(valore) || 1} onCambia={onCambia} min={1} max={50} />
      ) : (
        <Campo
          valore={String(valore)}
          onCambia={onCambia}
          segnaposto={campo.segnaposto}
          onInvio={onInvia}
          taglia="m"
          className={"w-full " + (campo.tipo === "cartella" ? "font-mono" : "")}
        />
      )}
      {campo.nota && <span className="block text-[10.5px] text-neutral-500">{campo.nota}</span>}
    </label>
  );
}
