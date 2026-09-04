import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { useStatoVista } from "../statoVista";
import { ICONE } from "../icone";
import { Wrench } from "lucide-react";

/**
 * La home: cosa sa fare Darkroom.
 *
 * Due piani, e questa pagina è solo il primo: **Strumenti** («cosa so fare»)
 * qui, **Progetti** («su cosa lo faccio») in `/studio`. La divisione la fanno
 * le due schede nella testata in alto, che ci sono sempre — quindi qui non se
 * ne rimettono altre due uguali sotto: due navigazioni identiche una sull'altra
 * si leggono come due cose diverse e non lo sono.
 *
 * Prima le due metà erano schiacciate insieme: ventun schede tutte uguali e,
 * in mezzo, quattro riquadri di progetti. Il risultato era che nessuna delle
 * due si leggeva, e il montaggio video — che esiste ed è completo — era la
 * sedicesima scheda di un muro, cioè invisibile.
 *
 * Tre regole che questa pagina si tiene:
 *
 * 1. **Il progetto si sceglie una volta.** Prima ogni scheda aveva il suo menu
 *    «in quale progetto»: ventun tendine che chiedevano ventun volte la stessa
 *    cosa, e che allargavano le schede a caso. Ora la scelta sta in cima, una
 *    sola, e tutte le schede parlano di quel progetto.
 * 2. **Gli strumenti stanno nei loro mestieri.** Le aree sono titoli, non solo
 *    filtri: si vede che esiste un reparto Montaggio anche senza cercarlo.
 * 3. **Le schede finiscono tutte alla stessa altezza.** I comandi sono
 *    ancorati in fondo, così una riga di schede è una riga e non una scalinata.
 *
 * L'elenco non è scritto qui: arriva dal catalogo del server, lo stesso che
 * risponde all'MCP. Una capacità nuova compare qui il giorno in cui esiste.
 */

export default function Home() {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [progetti, setProgetti] = useState<StudioProject[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.strumenti().then(setCat).catch((e) => setErr(String(e?.message ?? e)));
    api.studioProjects().then((r) => setProgetti(r.projects)).catch(() => {});
  }, []);

  return (
    <div className="space-y-4 pb-10">
      <Testata
        titolo="Strumenti"
        sotto="Tutto quello che Darkroom sa fare, diviso per mestiere. Lo stesso elenco che vede Claude via MCP."
      />

      {err && (
        <div className="rounded border border-rose-900 bg-rose-950/40 text-rose-200 text-[12px] px-2.5 py-1.5">
          Il catalogo non risponde: {err}
        </div>
      )}

      <Strumenti cat={cat} progetti={progetti} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Strumenti({ cat, progetti }: { cat: Catalogo | null; progetti: StudioProject[] }) {
  const [cerca, setCerca] = useState("");
  const [area, setArea] = useState<AreaStrumento | "tutte">("tutte");
  const [soloPronti, setSoloPronti] = useState(false);
  const navigate = useNavigate();

  /**
   * Il progetto su cui lavorano tutte le schede. Vive nell'URL, così una home
   * mandata a qualcuno apre lo stesso lavoro e non «l'ultimo che avevi tu».
   */
  const [pidScelto, setPid] = useStatoVista<string>("progetto", "", {
    leggi: (s) => s.trim() || null,
    memoria: "darkroom.home.progetto",
  });
  const pid = useMemo(() => {
    if (pidScelto && progetti.some((p) => p.id === pidScelto)) return pidScelto;
    const ultimo = lastProject();
    if (ultimo && progetti.some((p) => p.id === ultimo)) return ultimo;
    return progetti[0]?.id ?? "";
  }, [pidScelto, progetti]);
  const attivo = progetti.find((p) => p.id === pid) ?? null;

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

  /** Gli strumenti raggruppati nei loro mestieri, nell'ordine del catalogo. */
  const reparti = useMemo(() => {
    return (cat?.aree ?? [])
      .map((a) => ({ area: a, strumenti: visibili.filter((s) => s.area === a.id) }))
      .filter((r) => r.strumenti.length > 0);
  }, [cat, visibili]);

  const spenti = (cat?.strumenti ?? []).filter((s) => !s.pronto).length;

  return (
    <>
      {/* La barra: cerca, mestieri, e — una volta sola — su quale progetto.
          I numeri non sono decorazione: un filtro senza conteggio non dice se
          vale la pena aprirlo. */}
      <div className="sticky top-[var(--h-testata,57px)] z-20 -mx-4 px-4 py-2 bg-neutral-950/90 backdrop-blur
                      border-y border-neutral-800 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
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
            {spenti > 0 && <span className="ml-1 text-amber-400 tabular-nums">{(cat?.strumenti.length ?? 0) - spenti}</span>}
          </Bott>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-neutral-400">Lavoro su</span>
          {progetti.length > 0 ? (
            <Scegli
              valore={pid}
              voci={progetti.map((p) => ({
                v: p.id,
                testo: p.name,
                nota: p.views.join(" · "),
              }))}
              onCambia={setPid}
              larghezza={210}
              taglia="m"
              titolo="Il progetto su cui agiscono tutti gli strumenti qui sotto"
            />
          ) : (
            <span className="text-[11px] text-neutral-500">
              nessun progetto: comincia da uno strumento che ne crea uno.
            </span>
          )}
          {attivo && (
            <span className="text-[11px] text-neutral-500 truncate">
              {attivo.video
                ? `${attivo.video.tagli} tagli`
                : attivo.stats
                  ? `${attivo.stats.photos} foto · ${attivo.stats.favorites} preferite`
                  : ""}
            </span>
          )}
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
      </div>

      {!cat && <div className="text-[12px] text-neutral-400">Carico il catalogo…</div>}

      {cat && visibili.length === 0 && (
        <div className="text-[12px] text-neutral-400">
          Niente con questi filtri.{" "}
          <button
            className="underline hover:text-neutral-100"
            onClick={() => { setCerca(""); setArea("tutte"); setSoloPronti(false); }}
          >
            Rimettili a posto
          </button>
          .
        </div>
      )}

      <div className="space-y-6">
        {reparti.map(({ area: a, strumenti }) => (
          <section key={a.id} className="space-y-2">
            <div className="flex items-baseline gap-2 border-b border-neutral-800 pb-1.5">
              <h2 className="text-[12px] uppercase tracking-wide text-neutral-300">{a.nome}</h2>
              <span className="text-[11px] text-neutral-500 tabular-nums">{strumenti.length}</span>
              <span className="text-[11px] text-neutral-500 truncate">{a.cosa}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
              {strumenti.map((s) => (
                <SchedaStrumento
                  key={s.id}
                  s={s}
                  progetto={attivo}
                  progetti={progetti}
                  onFatto={(rotta) => navigate(rotta)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Uno strumento e le sue vie d'ingresso.
 *
 * La scheda è alta quanto le sue sorelle: intestazione in cima, comandi
 * ancorati in fondo (`mt-auto`). Prima ogni scheda finiva dove finiva il suo
 * testo e una riga di schede era una scalinata.
 */
function SchedaStrumento({
  s, progetto, progetti, onFatto,
}: {
  s: Strumento;
  progetto: StudioProject | null;
  progetti: StudioProject[];
  onFatto: (rotta: string) => void;
}) {
  const [aperto, setAperto] = useState<Avvio | null>(null);
  const I = ICONE[s.icona] ?? Wrench;

  return (
    <div
      className={
        "flex h-full flex-col rounded-lg border bg-neutral-950/60 p-3 transition-colors " +
        (s.pronto ? "border-neutral-800 hover:border-neutral-600" : "border-neutral-800/60")
      }
    >
      <div className="flex items-start gap-2.5">
        <I
          className={"w-4 h-4 mt-[2px] shrink-0 " + (s.pronto ? "text-neutral-300" : "text-neutral-500")}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className={"text-[13.5px] font-medium leading-tight " + (s.pronto ? "" : "text-neutral-400")}>
            {s.nome}
          </div>
          <p className="mt-1 text-[12px] text-neutral-400 leading-snug">{s.cosa}</p>
        </div>
      </div>

      {/* Non pronto non è «rotto»: è una cosa che manca, con il gesto che la
          sistema. Uno strumento grigio senza spiegazione è una porta chiusa. */}
      {!s.pronto && (
        <div className="mt-2 rounded border border-amber-900/60 bg-amber-950/20 px-2 py-1.5 space-y-0.5">
          {s.manca.map((m) => (
            <div key={m.requisito} className="text-[11px] text-amber-200/90 leading-snug">
              {m.come}
            </div>
          ))}
        </div>
      )}

      {/* Il piede: comandi e riferimenti, sempre nello stesso posto su ogni
          scheda. I nomi MCP erano una pastiglia «mcp ×3» il cui contenuto si
          leggeva solo col mouse fermo sopra: un riferimento che non si legge
          non è un riferimento. */}
      <div className="mt-auto pt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {s.avvii.map((a, i) =>
            a.modo === "apri" ? (
              <Apri key={i} avvio={a} strumento={s} progetto={progetto} progetti={progetti} onVai={onFatto} />
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

        {/* I nomi MCP, per chi guida Darkroom dalla chat. Erano una riga sola
            tagliata a metà da `truncate`: «check_photo · verification_summ…»
            non è un riferimento, è un indovinello. Vanno a capo, uno per
            pastiglia, e si leggono tutti. */}
        {s.mcp.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" title="I nomi con cui Claude chiama questo strumento via MCP">
            <span className="text-[10.5px] text-neutral-600 shrink-0">da Claude</span>
            {s.mcp.map((m) => (
              <code
                key={m}
                className="rounded-sm border border-neutral-800 bg-neutral-900/60 px-1 py-[1px]
                           font-mono text-[10px] leading-[14px] text-neutral-400"
              >
                {m}
              </code>
            ))}
          </div>
        )}
      </div>

      {aperto && aperto.modo !== "apri" && (
        <Modulo
          strumento={s}
          avvio={aperto}
          progetto={progetto}
          onAnnulla={() => setAperto(null)}
          onFatto={onFatto}
        />
      )}
    </div>
  );
}

/**
 * «Apri»: sul progetto scelto in cima, senza chiedere di nuovo.
 *
 * Se quel progetto non ha la vista che serve, il tasto NON si spegne: cerca il
 * primo progetto che ce l'ha e lo dice nell'etichetta. È il motivo per cui il
 * montaggio video sembrava non esistere — chi apriva la home con una galleria
 * di foto selezionata trovava quattro tasti grigi e nessun indizio che
 * «Lungomare» fosse lì, pronto, a un clic.
 *
 * Si spegne solo quando davvero non c'è nessun progetto con quella vista, e
 * allora lo dice con il gesto che lo sistema.
 */
function Apri({
  avvio, strumento, progetto, progetti, onVai,
}: {
  avvio: Extract<Avvio, { modo: "apri" }>;
  strumento: Strumento;
  progetto: StudioProject | null;
  progetti: StudioProject[];
  onVai: (rotta: string) => void;
}) {
  const serve = (p: StudioProject) => strumento.viste.length === 0 || p.views.includes(avvio.vista);
  const suScelto = !!progetto && serve(progetto);
  const ripiego = suScelto ? null : progetti.find(serve) ?? null;
  const bersaglio = suScelto ? progetto : ripiego;

  return (
    <Bott
      taglia="m"
      disabilitato={!bersaglio}
      titolo={
        bersaglio
          ? suScelto
            ? `Apre «${bersaglio.name}»`
            : `«${progetto?.name ?? "il progetto scelto"}» non ha la vista «${avvio.vista}»: questo apre «${bersaglio.name}», che ce l'ha.`
          : `Nessun progetto ha la vista «${avvio.vista}»: creane uno dallo strumento che lo fa, o accendile la vista dallo Studio.`
      }
      onClick={() => bersaglio && onVai(avvio.rotta.replace(":pid", encodeURIComponent(bersaglio.id)))}
    >
      {avvio.etichetta}
      {bersaglio && !suScelto && (
        <span className="ml-1 text-neutral-400">in {bersaglio.name}</span>
      )}
    </Bott>
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
  strumento, avvio, progetto, onAnnulla, onFatto,
}: {
  strumento: Strumento;
  avvio: Extract<Avvio, { modo: "nuovo" | "subito" }>;
  progetto: StudioProject | null;
  onAnnulla: () => void;
  onFatto: (rotta: string) => void;
}) {
  const [valori, setValori] = useState<Record<string, string | number>>(() =>
    Object.fromEntries(avvio.campi.map((c) => [c.nome, c.predefinito ?? ""])),
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
        progetto: avvio.modo === "subito" ? progetto?.id : undefined,
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
      <div className="mt-2 rounded border border-emerald-900/70 bg-emerald-950/20 p-2.5 space-y-2">
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
    <div className="mt-2 rounded border border-neutral-800 bg-neutral-900/40 p-2.5 space-y-2">
      {avvio.nota && <p className="text-[11px] text-neutral-400 leading-snug">{avvio.nota}</p>}

      {/* Su quale progetto non si chiede più: è quello scelto in cima. Detto,
          non taciuto — altrimenti «Genera adesso» è un tasto che non dice dove
          finisce la roba. */}
      {avvio.modo === "subito" && (
        <p className="text-[11px] text-neutral-500">
          {progetto ? <>Va in coda su <span className="text-neutral-300">{progetto.name}</span>.</> : "Nessun progetto scelto: ne apro uno nuovo."}
        </p>
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
