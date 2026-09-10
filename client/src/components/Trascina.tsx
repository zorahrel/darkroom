import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FolderDown } from "lucide-react";
import { api } from "../api";
import {
  EVENTO_TRASCINAMENTO,
  destinazionePer,
  leggiTrascinamento,
  nomeDaPercorso,
} from "../trascinamento";

/**
 * Le cartelle che arrivano dal Finder.
 *
 * Sta nel guscio dell'applicazione e non in una pagina, perché il trascinamento non
 * appartiene a nessuna: dove sei decide cosa succede — dentro un progetto le
 * fotografie diventano sue, fuori diventano un progetto nuovo — ma il gesto è
 * sempre disponibile.
 *
 * Nel browser non arriva mai niente e questo componente resta invisibile: è la
 * differenza fra le due versioni, ed è scritta in un posto solo.
 */
export function Trascina() {
  const [sopra, setSopra] = useState(false);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [lavorando, setLavorando] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Il percorso della pagina viene letto quando la cartella viene lasciata, non
  // quando l'ascoltatore viene installato: senza questo, chi apre un progetto e poi
  // trascina si vedrebbe creare un progetto nuovo.
  const dove = useRef(location.pathname);
  dove.current = location.pathname;

  useEffect(() => {
    const ascolta = async (e: Event) => {
      const t = leggiTrascinamento((e as CustomEvent).detail);
      if (!t) return;
      if (t.fase === "entra") { setSopra(true); return; }
      if (t.fase === "esce") { setSopra(false); return; }

      setSopra(false);
      if (t.percorsi.length === 0) return;
      setLavorando(true);
      setEsito(null);
      try {
        const destinazione = destinazionePer(dove.current);
        if (destinazione.tipo === "progetto") {
          let aggiunte = 0;
          for (const percorso of t.percorsi) {
            const r = await api.addSource(percorso, "link");
            aggiunte += r.summary?.added ?? 0;
          }
          setEsito({ ok: true, testo: aggiunte === 1 ? "1 fotografia aggiunta" : `${aggiunte} fotografie aggiunte` });
          // Le fotografie nuove devono comparire ovunque, non solo dove guardi
          // adesso: la pagina si rilegge una volta invece di indovinare quali
          // pezzi aggiornare.
          setTimeout(() => window.location.reload(), 1200);
        } else {
          let primo: string | null = null;
          for (const percorso of t.percorsi) {
            const r = await api.studioAddProject({
              name: nomeDaPercorso(percorso),
              // La cartella resta dove sta: diventa una sorgente, non la radice del
              // progetto. Mettercela dentro vorrebbe dire scrivere il database di
              // Darkroom in mezzo alle fotografie di chi le ha scattate.
              photos: { path: percorso, mode: "link" },
            });
            primo ??= r.project.id;
          }
          setEsito({ ok: true, testo: t.percorsi.length === 1 ? "Progetto creato" : `${t.percorsi.length} progetti creati` });
          if (primo) setTimeout(() => navigate(`/p/${primo}`), 700);
        }
      } catch (err) {
        setEsito({ ok: false, testo: err instanceof Error ? err.message : String(err) });
      } finally {
        setLavorando(false);
      }
    };
    window.addEventListener(EVENTO_TRASCINAMENTO, ascolta);
    return () => window.removeEventListener(EVENTO_TRASCINAMENTO, ascolta);
  }, [navigate]);

  useEffect(() => {
    if (!esito || !esito.ok) return;
    const t = setTimeout(() => setEsito(null), 4000);
    return () => clearTimeout(t);
  }, [esito]);

  if (!sopra && !esito && !lavorando) return null;

  return (
    <>
      {sopra && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 backdrop-blur-sm
                        pointer-events-none">
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-neutral-500
                          bg-neutral-900/80 px-10 py-8 text-center">
            <FolderDown className="w-8 h-8 text-neutral-300" aria-hidden />
            <div className="text-[15px] font-medium text-neutral-100">
              {destinazionePer(dove.current).tipo === "progetto"
                ? "Lascia qui le cartelle: diventano fotografie di questo progetto"
                : "Lascia qui le cartelle: ognuna diventa un progetto"}
            </div>
            <div className="text-[12px] text-neutral-400">Le fotografie non si spostano — restano dove sono.</div>
          </div>
        </div>
      )}

      {(esito || lavorando) && (
        <div role="status" aria-live="polite"
             className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-3 py-2 text-[12px]
                        shadow-lg border-neutral-700 bg-neutral-900 text-neutral-100">
          {lavorando ? "Sto guardando le cartelle…" : (
            <span className={esito!.ok ? "" : "text-rose-300"}>{esito!.testo}</span>
          )}
        </div>
      )}
    </>
  );
}
