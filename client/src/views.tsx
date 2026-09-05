import { Clapperboard, Film, Images, type LucideIcon } from "lucide-react";
import type { ProjectKind } from "./api";

/**
 * A project's views, in one place.
 *
 * A project is not of a type: it has views switched on. Real work starts with
 * the photos of a site visit, becomes a storyboard and ends in an edit — with a
 * single type you had to make three projects on the same folder.
 *
 * Name, icon and explanation live here because the project list, the tabs in
 * the top bar and the settings window all use them: three places that have to
 * say the same word.
 */
export type View = {
  id: ProjectKind;
  name: string;
  icon: LucideIcon;
  /** What you do with it. It goes in the button's title, not in a manual. */
  explains: string;
  /** Where it leads, inside a project. */
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
