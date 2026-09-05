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
export type View = {
  id: ProjectKind;
  name: string;
  icon: LucideIcon;
  /** Che cosa ci si fa. Va nel titolo del tasto, non in un manuale. */
  explains: string;
  /** Dove porta, dentro un progetto. */
  route: (pid: string) => string;
};

export const VIEWS: View[] = [
  {
    id: "photo",
    name: "foto",
    icon: Images,
    explains: "Galleria: griglia, versioni, colore, esportazione.",
    route: (pid) => `/p/${pid}`,
  },
  {
    id: "storyboard",
    name: "storyboard",
    icon: Clapperboard,
    explains: "Pannelli in sequenza da una scaletta, con durate e personaggi.",
    route: (pid) => `/p/${pid}/storyboard`,
  },
  {
    id: "video",
    name: "video",
    icon: Film,
    explains: "Montaggio derivato dalle misure del brano: tagli sul beat, riprese scelte per durezza.",
    route: (pid) => `/p/${pid}/video`,
  },
];

export const view = (id: ProjectKind): View => VIEWS.find((v) => v.id === id) ?? VIEWS[0]!;
