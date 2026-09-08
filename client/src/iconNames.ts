import {
  BookImage,
  FolderInput,
  FolderKanban,
  FolderOutput,
  GalleryHorizontal,
  GalleryHorizontalEnd,
  GitBranch,
  Gauge,
  ImagePlay,
  ImagePlus,
  Images,
  ListChecks,
  ListOrdered,
  ListX,
  PlugZap,
  Repeat2,
  ScanEye,
  ScissorsLineDashed,
  SlidersHorizontal,
  SwatchBook,
  Unlink,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * Il catalogo viaggia come JSON: qui ogni capacità diventa un segno visivo.
 *
 * Le chiavi dicono quale lavoro si apre, non il nome del disegno: lo stesso
 * gesto resta riconoscibile nelle schede, nelle viste e nello Studio.
 * Selezionare, sviluppare il colore e montare devono avere sagome diverse;
 * un unico simbolo di «strumento» obbligherebbe a rileggere ogni etichetta.
 */
export const ICONS: Record<string, LucideIcon> = {
  generate: ImagePlus,
  retouch: Repeat2,
  prompt: SlidersHorizontal,
  color: SwatchBook,
  export: FolderOutput,
  pipeline: Workflow,
  quality: ScanEye,
  defects: ListX,
  gallery: Images,
  sources: FolderInput,
  posts: GalleryHorizontalEnd,
  references: BookImage,
  tree: GitBranch,
  orphans: Unlink,
  storyboard: GalleryHorizontal,
  edit: ScissorsLineDashed,
  picks: ListChecks,
  shots: ImagePlay,
  gate: Gauge,
  projects: FolderKanban,
  queue: ListOrdered,
  status: PlugZap,
};
