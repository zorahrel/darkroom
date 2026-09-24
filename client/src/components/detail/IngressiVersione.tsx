import { useState } from "react";
import { Link } from "react-router-dom";
import type { Ingresso } from "../../api/types";
import { thumbGenUrl, thumbRefUrl } from "../../api/urls";
import { currentProject } from "../../api/http";

/**
 * Da cosa e' nata la versione che hai davanti: foto di partenza, riferimenti
 * allegati, prompt. Sta SOPRA l'anteprima, in alto, a ogni larghezza.
 *
 * PERCHE'. Il 24/09 l'utente guardava le versioni senza sapere con quali foto
 * erano state fatte («fammi vedere anche le foto reference e prompt quando la
 * vedo»). Il prompt c'era, ma in un riquadro chiuso dentro il carosello, e
 * sotto i 1024 px il carosello e' in una scheda dell'editor. Le immagini
 * d'ingresso non comparivano da nessuna parte — ed e' cosi' che per diverse
 * versioni gli ho passato una sua foto ritoccata da me senza che potesse
 * vederlo.
 *
 * Il TIPO si vede sulla miniatura, perche' e' il fatto che serve: «originale»
 * e' una sua foto intatta, «alterata» una sua foto modificata da uno script
 * (in ambra, perche' e' il caso da notare), «generata» una versione precedente.
 */
const ETICHETTA: Record<Ingresso["tipo"], { testo: string; classe: string }> = {
  originale: { testo: "originale", classe: "bg-emerald-900/80 text-emerald-100" },
  alterata: { testo: "alterata", classe: "bg-amber-600/90 text-black" },
  generata: { testo: "generata", classe: "bg-sky-900/80 text-sky-100" },
  riferimento: { testo: "ref", classe: "bg-neutral-800/90 text-neutral-200" },
  altro: { testo: "?", classe: "bg-neutral-800/90 text-neutral-300" },
};

export function IngressiVersione({
  photoId,
  voci,
  prompt,
}: {
  photoId: string;
  voci: Ingresso[];
  prompt: string;
}) {
  const [promptAperto, setPromptAperto] = useState(false);
  const pid = currentProject();

  const miniatura = (i: Ingresso) =>
    i.tipo === "generata" && i.versione !== null
      ? thumbGenUrl(i.foto ?? photoId, i.versione, 160)
      : thumbRefUrl(i.nome, 160);

  // Una reference si apre nella sua pagina, con il suo deprompt; una versione
  // generata apre quella versione. Una foto dell'utente non ha una pagina sua.
  const destinazione = (i: Ingresso): string | null => {
    if (i.tipo === "riferimento") return `/p/${pid}/references/${encodeURIComponent(i.nome)}`;
    if (i.tipo === "generata" && i.versione !== null)
      return `/p/${pid}/photo/${encodeURIComponent(i.foto ?? photoId)}?v=${i.versione}`;
    return null;
  };

  return (
    // `pointer-events-none` sul contenitore e `auto` sui figli: lo strato sta
    // sopra l'anteprima e non deve rubarle il «tieni premuto per l'originale».
    <div className="absolute top-2 left-2 right-2 z-10 flex flex-col items-start gap-2 pointer-events-none">
      <div className="flex flex-wrap items-end gap-1.5 pointer-events-auto">
        {voci.length === 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-neutral-300">
            ingressi non registrati
          </span>
        )}
        {voci.map((i, k) => {
          const et = ETICHETTA[i.tipo];
          const dest = destinazione(i);
          const corpo = (
            <figure className="m-0 w-20" title={`${i.ruolo}: ${i.nome}`}>
              <div
                className={
                  "relative h-20 w-20 overflow-hidden rounded bg-black/70 " +
                  (i.ruolo === "partenza" ? "ring-2 ring-white/80" : "ring-1 ring-white/20")
                }
              >
                <img src={miniatura(i)} alt={i.nome} className="h-full w-full object-cover" draggable={false} />
                <span className={`absolute bottom-0 left-0 right-0 text-center text-[10px] leading-4 ${et.classe}`}>
                  {et.testo}
                </span>
              </div>
              <figcaption className="mt-0.5 truncate text-[10px] text-neutral-200 [text-shadow:0_1px_2px_#000]">
                {i.ruolo === "partenza"
                  ? "partenza"
                  : i.foto && i.foto !== photoId
                    ? `${i.foto} v${i.versione}`
                    : i.nome}
              </figcaption>
            </figure>
          );
          return dest ? (
            <Link key={k} to={dest} className="hover:opacity-80">
              {corpo}
            </Link>
          ) : (
            <div key={k}>{corpo}</div>
          );
        })}
        {prompt && (
          <button
            type="button"
            onClick={() => setPromptAperto((x) => !x)}
            className="self-center h-7 px-2 rounded border border-neutral-600 bg-neutral-950/85 text-[11px] text-neutral-100 hover:border-neutral-300"
          >
            {promptAperto ? "chiudi prompt" : "prompt"}
          </button>
        )}
      </div>
      {promptAperto && (
        <pre className="pointer-events-auto max-h-[45vh] w-full max-w-2xl overflow-auto whitespace-pre-wrap rounded border border-neutral-700 bg-neutral-950/95 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
          {prompt}
        </pre>
      )}
    </div>
  );
}
