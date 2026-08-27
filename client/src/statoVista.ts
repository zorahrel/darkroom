import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Stato di una vista che sopravvive al ricaricamento e si puo' incollare a
 * qualcuno.
 *
 * La griglia lo faceva gia' a mano (URL come sorgente di verita', localStorage
 * come ripiego quando l'URL e' nudo), l'albero no: ogni volta che si tornava
 * sull'albero l'interruttore del riferimento era spento e la misura andava
 * rifatta. Erano due modi diversi di trattare la stessa cosa nella stessa
 * applicazione, quindi la regola ora sta scritta una volta sola.
 *
 * Perche' l'URL prima di localStorage: un filtro e' parte di *cosa stai
 * guardando*. Se vive solo nel browser, un link mandato a qualcun altro apre
 * una pagina diversa da quella che si aveva davanti.
 *
 * Il valore di default non finisce mai nell'URL: una barra degli indirizzi
 * piena di `?overlay=0&modo=sopra` quando e' tutto come appena aperto e' rumore
 * che nasconde i parametri che contano davvero.
 */
export function useStatoVista<T extends string | number | boolean>(
  chiave: string,
  predefinito: T,
  opzioni: {
    /** Da stringa a valore. Torna `null` se la stringa non e' accettabile:
     *  un `?zoom=banana` deve tornare al default, non rompere la vista. */
    leggi: (s: string) => T | null;
    /** Con che nome ricordarlo fra una sessione e l'altra. Assente = non si
     *  ricorda: giusto per le cose legate a *questo* elenco e non al modo in
     *  cui si lavora (una selezione, una ricerca). */
    memoria?: string;
  },
): [T, (v: T) => void] {
  const { leggi, memoria } = opzioni;
  const [searchParams, setSearchParams] = useSearchParams();
  // Solo alla prima resa: dopo, la sorgente di verita' e' lo stato di React.
  // Rileggere l'URL a ogni giro farebbe combattere due scritture in corsa.
  const [valore, setValore] = useState<T>(() => {
    const daUrl = searchParams.get(chiave);
    if (daUrl !== null) {
      const v = leggi(daUrl);
      if (v !== null) return v;
    }
    if (memoria) {
      const salvato = localStorage.getItem(memoria);
      if (salvato !== null) {
        const v = leggi(salvato);
        if (v !== null) return v;
      }
    }
    return predefinito;
  });

  // `setSearchParams` cambia identita' a ogni resa: dentro l'effetto si usa la
  // versione piu' fresca via ref, altrimenti l'effetto rigira all'infinito.
  const setParams = useRef(setSearchParams);
  setParams.current = setSearchParams;

  useEffect(() => {
    if (memoria) localStorage.setItem(memoria, String(valore));
    setParams.current(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (valore === predefinito) next.delete(chiave);
        else next.set(chiave, String(valore));
        return next;
      },
      { replace: true },
    );
    // `predefinito` e `chiave` sono costanti per chi chiama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valore]);

  const cambia = useCallback((v: T) => setValore(v), []);
  return [valore, cambia];
}

/** Letture pronte, cosi' ogni vista non si riscrive il suo parser. */
export const leggiBool = (s: string): boolean | null =>
  s === "1" || s === "true" ? true : s === "0" || s === "false" ? false : null;

export const leggiUnoDi =
  <T extends string>(ammessi: readonly T[]) =>
  (s: string): T | null =>
    (ammessi as readonly string[]).includes(s) ? (s as T) : null;

export const leggiNumero =
  (min: number, max: number) =>
  (s: string): number | null => {
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
