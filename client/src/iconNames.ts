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
 * From the icon's key to the icon.
 *
 * The tool catalogue lives in the server and travels as JSON, where a React
 * component does not fit: it sends a word. The translation lives here, in one
 * place, and an unknown key does not break the page — the reader supplies its
 * own fallback.
 */
export const ICONS: Record<string, LucideIcon> = {
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
