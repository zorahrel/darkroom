import { useCallback, useEffect, useMemo, useState } from "react";
import { jsonFetch, refUrl, pq } from "../api";
import { Pastiglie } from "../ui";
import { useStatoVista, leggiUnoDi } from "../statoVista";

// Dal riferimento alla ricetta (REF-02).
//
// L'estrazione e' una PROPOSTA, non un risultato: il modello locale a volte si
// contraddice nella stessa frase ("pori visibili e pelle levigata"), e una
// ricetta sbagliata si paga su ogni variante generata dopo. Per questo il testo
// arriva in un campo modificabile e si salva solo con un gesto esplicito.

type Recipe = { id: number; name: string; body: string; from_reference: string | null };
type Reference = { file: string; bytes: number; modified_at: number; usata_in: number };

export default function RiferimentiPage() {
  const [path, setPath] = useState("");
  const [testo, setTesto] = useState("");
  const [nome, setNome] = useState("");
  const [origine, setOrigine] = useState<string | null>(null);
  const [stato, setStato] = useState<{ tipo: "attesa" | "errore" | "ok"; msg: string } | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [sopra, setSopra] = useState(false);
  /** Quali reference mostrare. «mai usate» e' il filtro che conta: una
   *  reference a zero e' una passata intera andata nella direzione sbagliata
   *  senza che nessuno lo vedesse (su profilo e' successo 12 volte su 12), e
   *  con dodici miniature in griglia l'ambra da sola non basta a trovarle. */
  const [filtro, setFiltro] = useStatoVista<"tutte" | "usate" | "mai">("mostra", "tutte", {
    leggi: leggiUnoDi(["tutte", "usate", "mai"] as const),
    memoria: "darkroom.refs.mostra",
  });

  const conteggi = useMemo(
    () => ({
      tutte: refs.length,
      usate: refs.filter((r) => r.usata_in > 0).length,
      mai: refs.filter((r) => r.usata_in === 0).length,
    }),
    [refs],
  );
  /** Le mai usate in cima anche dentro il filtro «tutte»: sono quelle su cui
   *  c'e' qualcosa da decidere. */
  const visibili = useMemo(() => {
    const scelte =
      filtro === "usate"
        ? refs.filter((r) => r.usata_in > 0)
        : filtro === "mai"
          ? refs.filter((r) => r.usata_in === 0)
          : refs;
    return [...scelte].sort((a, b) => (a.usata_in === 0 ? 0 : 1) - (b.usata_in === 0 ? 0 : 1));
  }, [refs, filtro]);

  const carica = useCallback(async () => {
    const r = await jsonFetch<{ recipes: Recipe[] }>("/api/recipes");
    setRecipes(r.recipes);
    // Le reference del progetto: senza questa lista la pagina chiedeva di
    // incollare un percorso per un file che era gia' li' dentro.
    const q = await jsonFetch<{ references: Reference[] }>("/api/references").catch(() => ({
      references: [],
    }));
    setRefs(q.references);
  }, []);
  useEffect(() => {
    carica();
  }, [carica]);

  /** Carica i file scelti, uno per volta: un errore sul terzo non deve far
   *  perdere i primi due, e dirlo su quale e' fallito serve piu' di un
   *  "caricamento fallito" collettivo. */
  async function carica_file(files: FileList | File[]) {
    const lista = [...files];
    if (lista.length === 0) return;
    setStato({ tipo: "attesa", msg: `Carico ${lista.length} file…` });
    const errori: string[] = [];
    for (const f of lista) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const r = await fetch(pq("/api/references"), { method: "POST", body: fd });
        if (!r.ok) {
          const b = (await r.json().catch(() => ({}))) as { error?: string };
          errori.push(`${f.name}: ${b.error ?? r.status}`);
        }
      } catch (e) {
        errori.push(`${f.name}: ${String(e)}`);
      }
    }
    await carica();
    setStato(
      errori.length === 0
        ? { tipo: "ok", msg: `Caricati ${lista.length} riferimenti.` }
        : { tipo: "errore", msg: errori.join(" · ") },
    );
  }

  async function estrai() {
    setStato({ tipo: "attesa", msg: "Leggo il riferimento…" });
    try {
      const r = await jsonFetch<{ testo: string; aspetti: number; mancanti: string[]; from_reference: string }>(
        "/api/reference/extract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        },
      );
      setTesto(r.testo);
      setOrigine(r.from_reference);
      setNome((n) => n || r.from_reference.replace(/\.[^.]+$/, ""));
      // Cio' che non e' stato descritto va detto: e' la parte che dovra'
      // scrivere una persona, e se resta implicita non la scrive nessuno.
      setStato({
        tipo: "ok",
        msg: r.mancanti.length
          ? `Descritti ${r.aspetti} aspetti su 5. Non è riuscito a descrivere: ${r.mancanti.join(", ")} — aggiungili a mano.`
          : `Descritti tutti e 5 gli aspetti.`,
      });
    } catch (e) {
      setStato({ tipo: "errore", msg: String((e as Error).message || e) });
    }
  }

  async function salva() {
    try {
      await jsonFetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, body: testo, from_reference: origine }),
      });
      setStato({ tipo: "ok", msg: `Ricetta "${nome}" salvata.` });
      carica();
    } catch (e) {
      setStato({ tipo: "errore", msg: String((e as Error).message || e) });
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

      {/* La zona di rilascio c'e' anche a cartella vuota: e' proprio quando non
          c'e' niente che serve sapere come metterci qualcosa. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setSopra(true);
        }}
        onDragLeave={() => setSopra(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSopra(false);
          if (e.dataTransfer.files.length) carica_file(e.dataTransfer.files);
        }}
        className={
          "space-y-2 border border-dashed p-3 transition-colors " +
          (sopra ? "border-amber-500 bg-amber-950/20" : "border-neutral-800")
        }
      >
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-amber-500">
              riferimenti del progetto
            </h3>
            <Pastiglie
              voci={[
                { id: "tutte" as const, nome: "tutte" },
                { id: "usate" as const, nome: "usate" },
                { id: "mai" as const, nome: "mai usate" },
              ]}
              scelta={filtro}
              onScegli={setFiltro}
              conteggi={conteggi}
              neutra="tutte"
            />
            <label className="ml-auto text-[11px] text-neutral-400 hover:text-amber-500 cursor-pointer">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) carica_file(e.target.files);
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
          ) : visibili.length === 0 ? (
            /* Cartella piena ma filtro a vuoto: dirlo, invece di mostrare lo
               stesso messaggio del caso «non c'e' niente». */
            <p className="text-xs text-neutral-500 py-4 text-center">
              Nessuna reference in questo gruppo.{" "}
              <button onClick={() => setFiltro("tutte")} className="text-amber-500 hover:underline">
                mostra tutte
              </button>
            </p>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {visibili.map((r) => (
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
                  {/* Una reference a zero non e' un dettaglio: e' una passata
                      intera andata nella direzione sbagliata senza che nessuno
                      lo vedesse. Su profilo e' successo 12 volte su 12. */}
                  <div
                    className={
                      "font-mono text-[10px] " +
                      (r.usata_in === 0 ? "text-amber-500" : "text-neutral-500")
                    }
                  >
                    {r.usata_in === 0
                      ? "mai usata"
                      : `usata in ${r.usata_in} ${r.usata_in === 1 ? "variante" : "varianti"}`}
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
          disabled={!path || stato?.tipo === "attesa"}
          className="px-4 py-2 text-sm border border-neutral-700 hover:border-amber-500 hover:text-amber-500 disabled:opacity-40"
        >
          Estrai
        </button>
      </div>

      {stato && (
        <div
          className={
            "text-sm border-l-2 pl-3 py-1 " +
            (stato.tipo === "errore"
              ? "border-red-500 text-red-400"
              : stato.tipo === "attesa"
                ? "border-neutral-600 text-neutral-400"
                : "border-amber-500 text-neutral-300")
          }
        >
          {stato.msg}
        </div>
      )}

      {testo && (
        <div className="space-y-3">
          <textarea
            rows={7}
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            className="w-full text-sm bg-transparent border border-neutral-700 p-3 leading-relaxed resize-y"
          />
          <div className="flex items-center gap-2">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="nome della ricetta"
              className="bg-transparent border border-neutral-700 px-3 py-2 text-sm"
            />
            {origine && (
              <span className="font-mono text-[11px] text-neutral-400">da {origine}</span>
            )}
            <button
              onClick={salva}
              disabled={!nome || testo.trim().length < 25}
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
                    carica();
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
