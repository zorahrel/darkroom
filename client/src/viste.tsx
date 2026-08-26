import { Clapperboard, Film, Images, type LucideIcon } from "lucide-react";
import type { ProjectKind } from "./api";

/**
 * Le viste di un progetto, in un posto solo.
 *
 * Un progetto non è di un tipo: ha delle viste accese. Un lavoro vero comincia
 * con le foto di un sopralluogo, diventa uno storyboard e finisce in un
 * montaggio — con un tipo solo bisognava fare tre progetti sulla stessa
 * cartella.
 *
 * Nome, icona e spiegazione stanno qui perché li usano l'elenco dei progetti,
 * le schede della barra in alto e la finestra delle impostazioni: tre posti che
 * devono dire la stessa parola.
 */
export type Vista = {
  id: ProjectKind;
  nome: string;
  icona: LucideIcon;
  /** Che cosa ci si fa. Va nel titolo del tasto, non in un manuale. */
  spiega: string;
  /** Dove porta, dentro un progetto. */
  rotta: (pid: string) => string;
};

export const VISTE: Vista[] = [
  {
    id: "photo",
    nome: "foto",
    icona: Images,
    spiega: "Galleria: griglia, versioni, colore, esportazione.",
    rotta: (pid) => `/p/${pid}`,
  },
  {
    id: "storyboard",
    nome: "storyboard",
    icona: Clapperboard,
    spiega: "Pannelli in sequenza da una scaletta, con durate e personaggi.",
    rotta: (pid) => `/p/${pid}/storyboard`,
  },
  {
    id: "video",
    nome: "video",
    icona: Film,
    spiega: "Montaggio derivato dalle misure del brano: tagli sul beat, riprese scelte per durezza.",
    rotta: (pid) => `/p/${pid}/video`,
  },
];

export const vista = (id: ProjectKind): Vista => VISTE.find((v) => v.id === id) ?? VISTE[0]!;
