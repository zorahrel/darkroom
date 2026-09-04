import {
  Activity,
  CheckCheck,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  GitBranch,
  Gauge,
  Grid3x3,
  HelpCircle,
  Image,
  Images,
  Layers,
  List,
  Palette,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Video,
  Wand2,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * Dalla chiave dell'icona all'icona.
 *
 * Il catalogo degli strumenti vive nel server e viaggia in JSON, dove un
 * componente React non ci sta: manda una parola. La traduzione sta qui, in un
 * posto solo, e una chiave sconosciuta non rompe la pagina — chi legge mette
 * la sua chiave di riserva.
 */
export const ICONE: Record<string, LucideIcon> = {
  activity: Activity,
  check: CheckCheck,
  clapper: Clapperboard,
  download: Download,
  film: Film,
  folder: FolderOpen,
  gauge: Gauge,
  gitbranch: GitBranch,
  grid: Grid3x3,
  help: HelpCircle,
  image: Image,
  images: Images,
  layers: Layers,
  list: List,
  palette: Palette,
  plug: Plug,
  shield: ShieldCheck,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
  video: Video,
  wand: Wand2,
  workflow: Workflow,
};
