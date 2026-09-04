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

/**
 * Coda di scrittura condivisa fra tutti gli usi dell'hook.
 *
 * `null` come valore significa «togli questa chiave»: e' cio' che serve per non
 * lasciare i valori di default nell'URL.
 */
const held = new Map<string, string | null>();
let flushProgrammato = false;

function enqueue(
  key: string,
  value: string | null,
  applica: (fn: (prev: URLSearchParams) => URLSearchParams, opt: { replace: boolean }) => void,
) {
  held.set(key, value);
  if (flushProgrammato) return;
  flushProgrammato = true;
  // Un microtask, non un timer: si applica alla fine di questo giro di
  // rendering, prima che il browser dipinga, cosi' l'URL non "lampeggia".
  queueMicrotask(() => {
    flushProgrammato = false;
    if (held.size === 0) return;
    const edits = [...held.entries()];
    held.clear();
    applica(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of edits) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  });
}

export function useViewState<T extends string | number | boolean>(
  key: string,
  predefinito: T,
  opzioni: {
    /** Da stringa a valore. Torna `null` se la stringa non e' accettabile:
     *  un `?zoom=banana` deve tornare al default, non rompere la vista. */
    read: (s: string) => T | null;
    /** Con che nome ricordarlo fra una sessione e l'altra. Assente = non si
     *  ricorda: giusto per le cose legate a *questo* elenco e non al modo in
     *  cui si lavora (una selezione, una ricerca). */
    memoria?: string;
  },
): [T, (v: T) => void] {
  const { read, memoria } = opzioni;
  const [searchParams, setSearchParams] = useSearchParams();
  // Solo alla prima resa: dopo, la sorgente di verita' e' lo stato di React.
  // Rileggere l'URL a ogni giro farebbe combattere due scritture in corsa.
  const [value, setValue] = useState<T>(() => {
    const daUrl = searchParams.get(key);
    if (daUrl !== null) {
      const v = read(daUrl);
      if (v !== null) return v;
    }
    if (memoria) {
      const saved = localStorage.getItem(memoria);
      if (saved !== null) {
        const v = read(saved);
        if (v !== null) return v;
      }
    }
    return predefinito;
  });

  // Le scritture di piu' hook nello stesso istante vanno RIUNITE prima di
  // toccare l'URL.
  //
  // Ognuno scriveva per conto suo con l'aggiornamento funzionale, che sembra
  // sicuro e non lo e': React Router propaga la nuova location in modo
  // asincrono, quindi due hook che si svegliano nello stesso ciclo ricevono
  // entrambi lo STESSO `prev` e il secondo cancella la modifica del primo.
  // Osservato: aprendo `?zoom=180&group=scene`, tutti e due i valori sono
  // quelli di default e vanno tolti, ma ne spariva uno solo.
  //
  // Qui le modifiche si accumulano in una coda condivisa e si applicano in una
  // volta sola alla fine del giro.
  const setParams = useRef(setSearchParams);
  setParams.current = setSearchParams;

  useEffect(() => {
    if (memoria) localStorage.setItem(memoria, String(value));
    enqueue(key, value === predefinito ? null : String(value), setParams.current);
    // `predefinito` e `chiave` sono costanti per chi chiama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const change = useCallback((v: T) => setValue(v), []);
  return [value, change];
}

/** Letture pronte, cosi' ogni vista non si riscrive il suo parser. */
export const readBool = (s: string): boolean | null =>
  s === "1" || s === "true" ? true : s === "0" || s === "false" ? false : null;

export const readOneOf =
  <T extends string>(ammessi: readonly T[]) =>
  (s: string): T | null =>
    (ammessi as readonly string[]).includes(s) ? (s as T) : null;

export const readNumber =
  (min: number, max: number) =>
  (s: string): number | null => {
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
