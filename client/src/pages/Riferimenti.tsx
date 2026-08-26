import { useCallback, useEffect, useState } from "react";
import { jsonFetch } from "../api";

// Dal riferimento alla ricetta (REF-02).
//
// L'estrazione e' una PROPOSTA, non un risultato: il modello locale a volte si
// contraddice nella stessa frase ("pori visibili e pelle levigata"), e una
// ricetta sbagliata si paga su ogni variante generata dopo. Per questo il testo
// arriva in un campo modificabile e si salva solo con un gesto esplicito.

type Recipe = { id: number; name: string; body: string; from_reference: string | null };

export default function RiferimentiPage() {
  const [path, setPath] = useState("");
  const [testo, setTesto] = useState("");
  const [nome, setNome] = useState("");
  const [origine, setOrigine] = useState<string | null>(null);
  const [stato, setStato] = useState<{ tipo: "attesa" | "errore" | "ok"; msg: string } | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  const carica = useCallback(async () => {
    const r = await jsonFetch<{ recipes: Recipe[] }>("/api/recipes");
    setRecipes(r.recipes);
  }, []);
  useEffect(() => {
    carica();
  }, [carica]);

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
