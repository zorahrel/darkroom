import { useCallback, useEffect, useMemo, useState } from "react";
import { jsonFetch, refUrl, pq } from "../api";
import { Pills } from "../ui";
import { useViewState, readOneOf } from "../viewState";

// From the reference to the recipe (REF-02).
//
// The extraction is a PROPOSAL, not a result: the local model sometimes
// contradicts itself in the same sentence ("visible pores and smoothed skin"),
// and a wrong recipe is paid for on every variant generated afterwards. That is
// why the text arrives in an editable field and is saved only by an explicit
// gesture.

type Recipe = { id: number; name: string; body: string; from_reference: string | null };
type Ruolo = "stile" | "identita" | null;
type Reference = {
  file: string;
  bytes: number;
  modified_at: number;
  used_in: number;
  /** A cosa serve: tenere il viso o imporre un aspetto. Due lavori opposti sulla
   *  stessa immagine, e finora si distinguevano solo dal nome del file. */
  role?: Ruolo;
  /** Cosa c'e' dentro, letto dall'immagine: luce, tonalita', inquadratura,
   *  pelle, resa. `null` = mai letta, diverso da «letta e vuota». */
  prompt?: string | null;
  prompt_aspects?: number | null;
  prompt_missing?: string[];
};

export default function ReferencesPage() {
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: "waiting" | "error" | "ok"; msg: string } | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [above, setAbove] = useState(false);
  /** Which references to show. «never used» is the filter that matters: a
   *  reference at zero is a whole pass that went the wrong way without anybody
   *  seeing it (on profilo it happened 12 times out of 12), and with twelve
   *  thumbnails in a grid the amber alone is not enough to find them. */
  const [filter, setFilter] = useViewState<"all" | "used" | "never">("show", "all", {
    read: readOneOf(["all", "used", "never"] as const),
    memory: "darkroom.refs.show",
  });

  const counts = useMemo(
    () => ({
      all: refs.length,
      used: refs.filter((r) => r.used_in > 0).length,
      never: refs.filter((r) => r.used_in === 0).length,
    }),
    [refs],
  );
  /** The never-used ones first even inside the «all» filter: they are the ones
   *  with something to decide. */
  const visible = useMemo(() => {
    const picks =
      filter === "used"
        ? refs.filter((r) => r.used_in > 0)
        : filter === "never"
          ? refs.filter((r) => r.used_in === 0)
          : refs;
    return [...picks].sort((a, b) => (a.used_in === 0 ? 0 : 1) - (b.used_in === 0 ? 0 : 1));
  }, [refs, filter]);

  const load = useCallback(async () => {
    const r = await jsonFetch<{ recipes: Recipe[] }>("/api/recipes");
    setRecipes(r.recipes);
    // The project's references: without this list the page asked you to paste
    // a path for a file that was already in there.
    const q = await jsonFetch<{ references: Reference[] }>("/api/references").catch(() => ({
      references: [],
    }));
    setRefs(q.references);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /** Dichiara (o ritira) il ruolo di una reference.
   *
   *  Si aggiorna la riga subito e si rilegge l'elenco dopo: la scelta e' la
   *  risposta a «a cosa serve questa», e farla aspettare un giro di rete la fa
   *  sembrare non registrata. */
  async function cambiaRuolo(file: string, ruolo: Ruolo) {
    setRefs((v) => v.map((r) => (r.file === file ? { ...r, role: ruolo } : r)));
    try {
      await jsonFetch(`/api/references/${encodeURIComponent(file)}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: ruolo }),
      });
    } catch {
      // Se il server rifiuta, l'elenco riletto rimette la verita': meglio un
      // ritorno indietro visibile di una riga che mente.
      load();
    }
  }

  /** Quali riferimenti si stanno leggendo adesso: il bottone di quella scheda
   *  deve dire «leggo…» senza bloccare le altre. */
  const [leggendo, setLeggendo] = useState<Set<string>>(new Set());

  /**
   * Legge cosa c'e' dentro una reference e lo attacca a lei.
   *
   * Il motore esisteva gia' ma si azionava dal riquadro in cima, su un percorso
   * scritto a mano, e il risultato andava salvato come «ricetta» con un nome da
   * inventare: su questo progetto ne sono state salvate zero in tre settimane,
   * mentre la luce della stessa reference veniva descritta a mano sedici volte.
   * Qui il gesto sta SULL'immagine che si sta guardando, e il risultato resta.
   */
  async function leggiDentro(file: string) {
    setLeggendo((s) => new Set(s).add(file));
    try {
      const r = await jsonFetch<{ text: string; aspects: number; missing: string[] }>(
        "/api/reference/extract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: file }),
        },
      );
      setRefs((v) =>
        v.map((x) =>
          x.file === file
            ? { ...x, prompt: r.text, prompt_aspects: r.aspects, prompt_missing: r.missing }
            : x,
        ),
      );
    } catch (e) {
      setState({ kind: "error", msg: `${file}: ${String((e as Error).message || e)}` });
    } finally {
      setLeggendo((s) => {
        const n = new Set(s);
        n.delete(file);
        return n;
      });
    }
  }

  /**
   * Toglie un riferimento dall'elenco.
   *
   * La conferma e' PROPORZIONATA all'uso: una reference mai usata se ne va con
   * un clic — e' il caso di quelle caricate per sbaglio, che sono la ragione
   * per cui questo bottone esiste. Una gia' usata in varianti generate chiede
   * conferma, perche' toglierla cambia cosa si allega d'ora in poi.
   *
   * Il file non viene cancellato: il server lo sposta in `refs/_cestino`, e le
   * varianti che l'hanno gia' usata continuano a mostrarlo nell'albero.
   */
  async function togliRiferimento(file: string, usata: number) {
    if (usata > 0) {
      const q = `«${file}» è allegata a ${usata} ${usata === 1 ? "variante" : "varianti"}.\n\nToglierla dall'elenco? Le varianti già fatte restano intatte.`;
      if (!confirm(q)) return;
    }
    // Sparisce subito dall'elenco: l'attesa di una richiesta su un gesto di
    // pulizia fa cliccare due volte.
    setRefs((v) => v.filter((r) => r.file !== file));
    try {
      await jsonFetch(`/api/references/${encodeURIComponent(file)}`, { method: "DELETE" });
    } catch {
      load();
    }
  }

  /** Uploads the chosen files one at a time: an error on the third must not
   *  lose the first two, and saying which one failed is worth more than a
   *  collective "upload failed". */
  async function loadFiles(chosen: FileList | File[]) {
    const files = [...chosen];
    if (files.length === 0) return;
    setState({ kind: "waiting", msg: `Carico ${files.length} file…` });
    const errors: string[] = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const r = await fetch(pq("/api/references"), { method: "POST", body: fd });
        if (!r.ok) {
          const b = (await r.json().catch(() => ({}))) as { error?: string };
          errors.push(`${f.name}: ${b.error ?? r.status}`);
        }
      } catch (e) {
        errors.push(`${f.name}: ${String(e)}`);
      }
    }
    await load();
    setState(
      errors.length === 0
        ? { kind: "ok", msg: `Caricati ${files.length} riferimenti.` }
        : { kind: "error", msg: errors.join(" · ") },
    );
  }

  async function extract() {
    setState({ kind: "waiting", msg: "Leggo il riferimento…" });
    try {
      const r = await jsonFetch<{ text: string; aspects: number; missing: string[]; from_reference: string }>(
        "/api/reference/extract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        },
      );
      setText(r.text);
      setSource(r.from_reference);
      setName((n) => n || r.from_reference.replace(/\.[^.]+$/, ""));
      // What was not described has to be said: it is the part a person will
      // have to write, and if it stays implicit nobody writes it.
      setState({
        kind: "ok",
        msg: r.missing.length
          ? `Descritti ${r.aspects} aspetti su 5. Non è riuscito a descrivere: ${r.missing.join(", ")} — aggiungili a mano.`
          : `Descritti tutti e 5 gli aspetti.`,
      });
    } catch (e) {
      setState({ kind: "error", msg: String((e as Error).message || e) });
    }
  }

  async function save() {
    try {
      await jsonFetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, body: text, from_reference: source }),
      });
      setState({ kind: "ok", msg: `Ricetta "${name}" salvata.` });
      load();
    } catch (e) {
      setState({ kind: "error", msg: String((e as Error).message || e) });
    }
  }

  return (
    /* La larghezza massima sta sui blocchi di TESTO, non su tutta la pagina.
       Misurato: con `max-w-3xl` sul contenitore la colonna restava a 768 px a
       qualunque risoluzione — a 1440 px il 46% dello schermo era vuoto, a 1920
       il 59%, e la griglia dei riferimenti restava a 4 miniature per riga con
       centinaia di pixel liberi accanto.
       Il limite serve alla PROSA, dove una riga lunga 1900 px diventa
       illeggibile; una griglia di immagini non ha quel problema e deve usare lo
       spazio che c'e'. */
    <div className="space-y-6 py-4 pb-20">
      <div className="space-y-2 max-w-3xl">
        <h2 className="text-lg font-semibold">Riferimento → ricetta</h2>
        <p className="text-sm text-neutral-400">
          Un'immagine di riferimento diventa un testo riusabile: luce, tonalità, inquadratura,
          pelle, trattamento. Il testo è una proposta da correggere, non un risultato.
        </p>
      </div>

      {/* The drop zone is there even with an empty folder: it is exactly when
          there is nothing that you need to know how to put something in. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setAbove(true);
        }}
        onDragLeave={() => setAbove(false)}
        onDrop={(e) => {
          e.preventDefault();
          setAbove(false);
          if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
        }}
        className={
          "space-y-2 border border-dashed p-3 transition-colors " +
          (above ? "border-amber-500 bg-amber-950/20" : "border-neutral-800")
        }
      >
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-amber-500">
              riferimenti del progetto
            </h3>
            <Pills
              items={[
                { id: "all" as const, name: "tutte" },
                { id: "used" as const, name: "usate" },
                { id: "never" as const, name: "mai usate" },
              ]}
              pick={filter}
              onChoose={setFilter}
              counts={counts}
              neutral="all"
            />
            <label className="ml-auto text-[11px] text-neutral-400 hover:text-amber-500 cursor-pointer">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) loadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              scegli un file
            </label>
          </div>
          {refs.length === 0 ? (
            <p className="text-xs text-neutral-500 py-4 text-center">
              Trascina qui un'immagine di stile, oppure scegli un file.
            </p>
          ) : visible.length === 0 ? (
            /* Full folder but an empty filter: say so, instead of showing the
               same message as the «there is nothing» case. */
            <p className="text-xs text-neutral-500 py-4 text-center">
              Nessuna reference in questo gruppo.{" "}
              <button onClick={() => setFilter("all")} className="text-amber-500 hover:underline">
                mostra tutte
              </button>
            </p>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {visible.map((r) => (
              <figure key={r.file} className="group relative m-0 border border-neutral-800 bg-neutral-900">
                {/* `aspect-[3/4]` e `object-contain`, non un quadrato che ritaglia.
                    Misurato il 14/09 in un riquadro 691x651: le miniature erano
                    rese 198x198 con `object-cover`, mentre i file stanno fra 0,56
                    e 1,33 di rapporto — su una reference verticale (0,56) il
                    quadrato mostra meno della meta' dell'immagine, tagliata al
                    centro, cioe' proprio il viso quando la posa non e' centrata.
                    Una griglia di riferimenti serve a RICONOSCERLI: contain
                    mostra tutto, e il 3/4 e' il taglio dei ritratti che questo
                    progetto usa. */}
                <img
                  src={refUrl(r.file)}
                  alt={r.file}
                  loading="lazy"
                  title="Usa questo riferimento"
                  onClick={() => setPath(r.file)}
                  className="w-full aspect-[3/4] object-contain bg-neutral-950 cursor-pointer"
                />
                {/* Il bottone che toglie sta SULL'immagine, non in fondo alla
                    scheda: si decide guardando la foto, e con 30 riferimenti in
                    griglia una riga di comandi per ciascuno sarebbe rumore.
                    Sempre presente ma tenue, pieno al passaggio del mouse —
                    su touch, dove `hover` non esiste, resta comunque toccabile. */}
                <button
                  type="button"
                  title={`Togli «${r.file}» dall'elenco`}
                  aria-label={`Togli ${r.file} dall'elenco`}
                  onClick={() => togliRiferimento(r.file, r.used_in)}
                  className="absolute top-1 right-1 h-7 w-7 grid place-items-center rounded
                             border border-neutral-700 bg-neutral-950/85 text-neutral-200
                             text-base leading-none
                             hover:bg-red-950 hover:border-red-800 hover:text-red-300
                             transition-colors"
                >
                  ×
                </button>
                <figcaption className="px-2 py-1.5 space-y-0.5">
                  <div className="text-[11px] truncate text-neutral-300" title={r.file}>
                    {r.file}
                  </div>
                  {/* A reference at zero is not a detail: it is a whole pass that
                      went the wrong way without anybody seeing it. On profilo
                      it happened 12 times out of 12. */}
                  <div
                    className={
                      "font-mono text-[10px] " +
                      (r.used_in === 0 ? "text-amber-500" : "text-neutral-500")
                    }
                  >
                    {r.used_in === 0
                      ? "mai usata"
                      : `usata in ${r.used_in} ${r.used_in === 1 ? "variante" : "varianti"}`}
                  </div>
                  {/* Il ruolo si dichiara qui, dove si guarda l'immagine.
                      Allegare come stile una reference di identita' fa somigliare
                      ogni scatto a lei; il contrario cambia la faccia. Non si
                      indovina dal nome, e «non dichiarato» resta una terza
                      risposta, non un valore di riposo. */}
                  <div className="flex items-center gap-1 pt-0.5">
                    {(["identita", "stile"] as const).map((ruolo) => (
                      <button
                        key={ruolo}
                        type="button"
                        onClick={() => cambiaRuolo(r.file, r.role === ruolo ? null : ruolo)}
                        title={
                          ruolo === "identita"
                            ? "Tiene il viso: allegata per far restare la persona se stessa"
                            : "Impone un aspetto: luce, colore, resa"
                        }
                        className={
                          "font-mono text-[10px] px-1.5 py-0.5 border transition-colors " +
                          (r.role === ruolo
                            ? "border-neutral-300 text-neutral-100 bg-neutral-800"
                            : "border-neutral-800 text-neutral-500 hover:text-neutral-200")
                        }
                      >
                        {ruolo === "identita" ? "identità" : "stile"}
                      </button>
                    ))}
                    {/* «Non dichiarato» resta una terza risposta esplicita — non
                        un valore di riposo — ma per esteso mandava la riga a capo
                        su una scheda da 190 px, e due bottoni spezzati su due
                        righe sono il rumore che fa sembrare disordinata tutta la
                        griglia. Un trattino dice la stessa cosa in un carattere,
                        e il nome per esteso e' nel `title`. */}
                    {!r.role && (
                      <span
                        title="ruolo non dichiarato"
                        className="font-mono text-[10px] text-neutral-600 cursor-help"
                      >
                        —
                      </span>
                    )}
                  </div>
                  {/* IL DEPROMPT, sotto l'immagine da cui viene.
                      Cosa c'e' dentro una reference — luce, tonalita',
                      inquadratura, pelle, resa — decide cosa succede quando la
                      alleghi, e finora si poteva sapere solo aprendola e
                      guardandola. Il testo e' lungo: `line-clamp-3` ne mostra
                      l'inizio e `title` lo da' intero al passaggio del mouse,
                      cosi' trenta schede restano una griglia e non un muro. */}
                  {r.prompt ? (
                    <p
                      title={r.prompt}
                      className="text-[10px] leading-snug text-neutral-400 line-clamp-3 pt-1 border-t border-neutral-800 cursor-help"
                    >
                      {r.prompt}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => leggiDentro(r.file)}
                      disabled={leggendo.has(r.file)}
                      title="Legge dall'immagine: luce, tonalità, inquadratura, pelle, resa"
                      className="w-full text-left text-[10px] pt-1 border-t border-neutral-800
                                 text-neutral-500 hover:text-neutral-200 disabled:text-neutral-600"
                    >
                      {leggendo.has(r.file) ? "leggo…" : "leggi cosa c'è dentro"}
                    </button>
                  )}
                  {/* Quello che il modello NON e' riuscito a descrivere si dice:
                      e' la parte che tocca scrivere a mano, e se resta implicita
                      nessuno la scrive. */}
                  {r.prompt && (r.prompt_missing?.length ?? 0) > 0 && (
                    <div className="font-mono text-[9px] text-amber-600/80">
                      non letto: {r.prompt_missing!.join(", ")}
                    </div>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
      </div>

      <div className="flex gap-2 max-w-3xl">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/percorso/della/reference.jpg"
          className="flex-1 bg-transparent border border-neutral-700 px-3 py-2 text-sm font-mono"
        />
        <button
          onClick={extract}
          disabled={!path || state?.kind === "waiting"}
          className="px-4 py-2 text-sm border border-neutral-700 hover:border-amber-500 hover:text-amber-500 disabled:opacity-40"
        >
          Estrai
        </button>
      </div>

      {state && (
        <div
          className={
            "text-sm border-l-2 pl-3 py-1 " +
            (state.kind === "error"
              ? "border-red-500 text-red-400"
              : state.kind === "waiting"
                ? "border-neutral-600 text-neutral-400"
                : "border-amber-500 text-neutral-300")
          }
        >
          {state.msg}
        </div>
      )}

      {text && (
        <div className="space-y-3 max-w-3xl">
          <textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full text-sm bg-transparent border border-neutral-700 p-3 leading-relaxed resize-y"
          />
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nome della ricetta"
              className="bg-transparent border border-neutral-700 px-3 py-2 text-sm"
            />
            {source && (
              <span className="font-mono text-[11px] text-neutral-400">da {source}</span>
            )}
            <button
              onClick={save}
              disabled={!name || text.trim().length < 25}
              className="ml-auto px-4 py-2 text-sm border border-neutral-700 hover:border-amber-500 hover:text-amber-500 disabled:opacity-40"
            >
              Salva come ricetta
            </button>
          </div>
        </div>
      )}

      {recipes.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-neutral-800 max-w-3xl">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-neutral-400">
            Ricette salvate
          </h3>
          {recipes.map((r) => (
            <details key={r.id} className="border border-neutral-800 px-3 py-2">
              <summary className="text-sm cursor-pointer flex items-center gap-2">
                <span className="font-semibold">{r.name}</span>
                {r.from_reference && (
                  <span className="font-mono text-[10px] text-neutral-400">
                    da {r.from_reference}
                  </span>
                )}
                <button
                  className="ml-auto text-neutral-400 hover:text-red-400 text-xs"
                  onClick={async (e) => {
                    e.preventDefault();
                    await jsonFetch(`/api/recipes/${r.id}`, { method: "DELETE" });
                    load();
                  }}
                >
                  elimina
                </button>
              </summary>
              <p className="text-sm text-neutral-300 pt-2 leading-relaxed">{r.body}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
