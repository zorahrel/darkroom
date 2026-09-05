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
type Reference = { file: string; bytes: number; modified_at: number; used_in: number };

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

  async function estrai() {
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
    <div className="max-w-3xl space-y-6 py-4 pb-20">
      <div className="space-y-2">
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {visible.map((r) => (
              <figure key={r.file} className="m-0 border border-neutral-800 bg-neutral-900">
                <img
                  src={refUrl(r.file)}
                  alt={r.file}
                  loading="lazy"
                  title="Usa questo riferimento"
                  onClick={() => setPath(r.file)}
                  className="w-full aspect-square object-cover bg-neutral-950 cursor-pointer"
                />
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
                </figcaption>
              </figure>
            ))}
          </div>
      </div>

      <div className="flex gap-2">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/percorso/della/reference.jpg"
          className="flex-1 bg-transparent border border-neutral-700 px-3 py-2 text-sm font-mono"
        />
        <button
          onClick={estrai}
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
        <div className="space-y-3">
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
        <div className="space-y-2 pt-2 border-t border-neutral-800">
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
