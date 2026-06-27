import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  Film,
  Thermometer,
  Sunrise,
  Palette,
  Contrast,
  Moon,
  Sun,
  Smile,
  CloudFog,
  Sparkles,
  Aperture,
  Focus,
  Blend,
  UtensilsCrossed,
  Ruler,
  LayoutGrid,
  Eraser,
  Lock,
  Ban,
  PenLine,
  FileText,
} from "lucide-react";
import type { PromptConfig, PreserveKey, ExcludeKey } from "../api";

type Opt<T extends string> = { value: T; label: string; hint?: string };

/** Shared base photo shown for "neutral" (preserve/none/off) options — no
 *  generation needed for those, they represent "leave as-is". */
const BASE_PREVIEW = "/previews/_base.jpg";
const previewUrl = (group: string, value: string) =>
  `/previews/${group}/${value}.jpg`;

// ---- Visual groups (cards with thumbnails) --------------------------------
// `base` marks the value that means "no change": it reuses the base photo as
// its preview, so we never have to generate an image for it.

type VisualGroup = {
  key: keyof PromptConfig;
  icon: LucideIcon;
  label: string;
  base?: string;
  options: Opt<string>[];
};

const VISUAL_GROUPS: VisualGroup[] = [
  {
    key: "preset",
    icon: Clapperboard,
    label: "Preset",
    options: [
      { value: "cinematic", label: "Cinematic", hint: "Color grade cinematografico, editorial premium" },
      { value: "editorial", label: "Editorial", hint: "Look magazine pulito e raffinato" },
      { value: "documentary", label: "Documentary", hint: "Fotogiornalismo naturalistico" },
      { value: "fine-art", label: "Fine art", hint: "Stampa fine-art, gamma tonale museale" },
    ],
  },
  {
    key: "film_stock",
    icon: Film,
    label: "Pellicola",
    base: "none",
    options: [
      { value: "none", label: "Nessuna", hint: "Nessuna emulazione pellicola" },
      { value: "portra-400", label: "Portra 400", hint: "Kodak Portra 400" },
      { value: "portra-800", label: "Portra 800", hint: "Portra 800, incarnati più caldi" },
      { value: "cinestill-800t", label: "Cinestill 800T", hint: "Bilanciamento tungsteno, halation rossa" },
      { value: "ektar-100", label: "Ektar 100", hint: "Alta saturazione, grana fine" },
      { value: "fuji-400h", label: "Fuji 400H", hint: "Verdi pastello, toni freddi" },
    ],
  },
  {
    key: "white_balance",
    icon: Thermometer,
    label: "Bilanc. bianco",
    base: "preserve",
    options: [
      { value: "preserve", label: "Mantieni", hint: "Lascia il bilanciamento originale" },
      { value: "neutral", label: "Neutro", hint: "Bianco accurato, rimuove dominanti" },
      { value: "warm", label: "Caldo", hint: "Sposta verso il caldo" },
      { value: "cool", label: "Freddo", hint: "Sposta verso il freddo" },
    ],
  },
  {
    key: "time_of_day",
    icon: Sunrise,
    label: "Luce",
    base: "preserve",
    options: [
      { value: "preserve", label: "Mantieni", hint: "Lascia la luce originale" },
      { value: "golden", label: "Golden hour", hint: "Calore da ora dorata" },
      { value: "blue", label: "Blue hour", hint: "Toni freddi crepuscolari" },
      { value: "overcast", label: "Coperto", hint: "Luce diffusa da cielo coperto" },
      { value: "noon", label: "Mezzogiorno", hint: "Luce dura di mezzogiorno" },
      { value: "tungsten", label: "Tungsteno", hint: "Calore da luce interna tungsteno" },
    ],
  },
  {
    key: "palette",
    icon: Palette,
    label: "Palette",
    base: "preserve",
    options: [
      { value: "preserve", label: "Mantieni", hint: "Lascia la palette originale" },
      { value: "warm-earth", label: "Warm earth", hint: "Terracotta e ocra" },
      { value: "teal-orange", label: "Teal & orange", hint: "Ombre teal + alte luci arancio" },
      { value: "desaturated", label: "Desaturato", hint: "Toni muti, bassa croma" },
      { value: "high-saturation", label: "High-sat", hint: "Colore editoriale saturo" },
    ],
  },
  {
    key: "contrast",
    icon: Contrast,
    label: "Contrasto",
    base: "natural",
    options: [
      { value: "flat", label: "Flat", hint: "Basso contrasto, piatto" },
      { value: "natural", label: "Naturale", hint: "Contrasto medio naturale" },
      { value: "punchy", label: "Punchy", hint: "Alto contrasto deciso" },
    ],
  },
  {
    key: "shadows",
    icon: Moon,
    label: "Ombre",
    base: "natural",
    options: [
      { value: "natural", label: "Naturali", hint: "Densità ombre naturale" },
      { value: "lifted", label: "Lifted", hint: "Ombre filmiche sollevate" },
      { value: "crushed", label: "Crushed", hint: "Ombre profonde senza perdere dettaglio" },
    ],
  },
  {
    key: "highlights",
    icon: Sun,
    label: "Alte luci",
    base: "preserve",
    options: [
      { value: "preserve", label: "Mantieni", hint: "Lascia le alte luci" },
      { value: "warm-lift", label: "Warm lift", hint: "Solleva e scalda le alte luci" },
      { value: "cool-lift", label: "Cool lift", hint: "Solleva con tinta fredda" },
      { value: "muted", label: "Muted", hint: "Recupera dettaglio nei bianchi" },
      { value: "neutral", label: "Neutral boost", hint: "Solleva senza shift colore" },
    ],
  },
  {
    key: "skin_tones",
    icon: Smile,
    label: "Incarnati",
    base: "preserve",
    options: [
      { value: "preserve", label: "Mantieni", hint: "Lascia incarnati originali" },
      { value: "airy-lift", label: "Airy lift", hint: "Più chiari, ariosi, leggermente desaturati" },
      { value: "desaturate", label: "Desaturato", hint: "Riduce la croma di pelle/rosa" },
      { value: "saturate", label: "Saturo/caldo", hint: "Incarnati più caldi e ricchi" },
      { value: "porcelain", label: "Porcelain", hint: "Pelle porcellana, sottotoni freddi" },
    ],
  },
  {
    key: "atmosphere",
    icon: CloudFog,
    label: "Atmosfera",
    base: "preserve",
    options: [
      { value: "preserve", label: "Mantieni", hint: "Lascia l'atmosfera originale" },
      { value: "clean", label: "Pulisci", hint: "Rimuove foschia, aumenta chiarezza" },
      { value: "enhance", label: "Più mist", hint: "Esalta foschia e profondità atmosferica" },
      { value: "dreamy", label: "Dreamy", hint: "Diffusione morbida, glow soft" },
    ],
  },
  {
    key: "bloom",
    icon: Sparkles,
    label: "Bloom",
    base: "off",
    options: [
      { value: "off", label: "Off", hint: "Nessun bloom" },
      { value: "subtle", label: "Subtle", hint: "Bloom cinematografico morbido sulle sorgenti di luce" },
      { value: "glow", label: "Glow", hint: "Bloom marcato, aloni luminosi, night-glow" },
      { value: "halation", label: "Halation", hint: "Halation rossa stile Cinestill" },
    ],
  },
  {
    key: "grain",
    icon: Aperture,
    label: "Grana",
    base: "none",
    options: [
      { value: "none", label: "Nessuna", hint: "Nessuna grana" },
      { value: "fine", label: "Fine 35mm", hint: "Grana 35mm appena visibile" },
      { value: "visible", label: "Visibile 800", hint: "Grana ISO 800 visibile" },
    ],
  },
  {
    key: "dof",
    icon: Focus,
    label: "Profondità",
    base: "preserve",
    options: [
      { value: "preserve", label: "Mantieni DoF", hint: "Lascia la profondità di campo" },
      { value: "shallow", label: "Shallow bokeh", hint: "Stacca il soggetto con bokeh" },
    ],
  },
  {
    key: "harmony",
    icon: Blend,
    label: "Armonia",
    base: "off",
    options: [
      { value: "off", label: "Off", hint: "Nessuna armonizzazione" },
      { value: "subtle", label: "Sottile", hint: "Palette coerente, transizioni bilanciate" },
      { value: "strong", label: "Decisa", hint: "Armonia forte, complementari bilanciati" },
    ],
  },
  {
    key: "food",
    icon: UtensilsCrossed,
    label: "Cibo",
    base: "off",
    options: [
      { value: "off", label: "Off", hint: "Nessun ritocco cibo" },
      { value: "enhance", label: "Migliora", hint: "Rende cibo/bevande appetitosi senza alterarli" },
    ],
  },
];

// ---- Non-visual single-selects (text dropdowns, no thumbnails) -------------

type TextGroup = {
  key: keyof PromptConfig;
  icon: LucideIcon;
  label: string;
  options: Opt<string>[];
};

const TEXT_GROUPS: TextGroup[] = [
  {
    key: "geometry",
    icon: Ruler,
    label: "Geometria",
    options: [
      { value: "off", label: "Off" },
      { value: "straighten", label: "Raddrizza (orizzonte/verticali)" },
      { value: "correct", label: "Correggi prospettiva" },
    ],
  },
  {
    key: "composition",
    icon: LayoutGrid,
    label: "Composizione",
    options: [
      { value: "off", label: "Off" },
      { value: "rebalance", label: "Ribilancia (crop sicuro)" },
      { value: "recompose", label: "Ricomponi (può alterare bordi)" },
    ],
  },
  {
    key: "cleanup",
    icon: Eraser,
    label: "Cleanup",
    options: [
      { value: "off", label: "Nessuna pulizia" },
      { value: "minor", label: "Distractor minori + prospettiva" },
      { value: "aggressive", label: "Pulizia aggressiva" },
    ],
  },
];

const PRESERVE_LIST: { value: PreserveKey; label: string }[] = [
  { value: "composition", label: "Composizione e geometria" },
  { value: "identity", label: "Identità del soggetto / volti" },
  { value: "time_of_day", label: "Ora del giorno e logica scena" },
  { value: "textures", label: "Textures e materiali" },
  { value: "signs_text", label: "Cartelli, testo, scritte" },
  { value: "color_balance", label: "Bilanciamento colore originale" },
  { value: "weather", label: "Meteo / atmosfera" },
  { value: "cast_shadows", label: "Ombre naturali" },
  { value: "lighting_direction", label: "Direzione luce" },
  { value: "nature_colors", label: "Verdi e blu naturali" },
  { value: "natural_grain", label: "Grana naturale" },
];

const EXCLUDE_LIST: { value: ExcludeKey; label: string }[] = [
  { value: "no_added_elements", label: "Niente elementi aggiunti/rimossi" },
  { value: "no_smoothing", label: "Niente plastic skin / smoothing" },
  { value: "no_oversaturation", label: "Niente HDR / oversaturazione" },
  { value: "no_neon_flare", label: "Niente neon glow / lens flare" },
  { value: "no_chromatic_vignette", label: "Niente CA / vignettatura forte" },
  { value: "no_motion_blur", label: "Niente motion blur" },
  { value: "no_orton", label: "Niente Orton glow / hazy" },
  { value: "no_painterly", label: "Niente effetto pittorico" },
  { value: "no_face_morph", label: "Niente beauty / face morph" },
  { value: "no_new_objects", label: "Niente nuovi oggetti / scritte inventate" },
];

// ---- Thumbnail with graceful fallback -------------------------------------

function Thumb({
  src,
  alt,
  className,
  fallbackChar,
}: {
  src: string;
  alt: string;
  className: string;
  fallbackChar: string;
}) {
  const [errored, setErrored] = useState(false);
  useEffect(() => setErrored(false), [src]);
  if (errored) {
    return (
      <div
        className={
          className +
          " flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-950 text-neutral-600"
        }
      >
        <span className="text-xs font-semibold">{fallbackChar}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setErrored(true)}
      className={className + " object-cover"}
    />
  );
}

function PreviewCard({
  group,
  value,
  label,
  hint,
  selected,
  isBase,
  onClick,
}: {
  group: string;
  value: string;
  label: string;
  hint?: string;
  selected: boolean;
  isBase: boolean;
  onClick: () => void;
}) {
  const src = isBase ? BASE_PREVIEW : previewUrl(group, value);
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={selected}
      className="group/card w-[84px] shrink-0 text-left focus:outline-none"
    >
      <div
        className={
          "relative aspect-square w-full overflow-hidden rounded-lg border transition-all " +
          (selected
            ? "border-emerald-500 ring-2 ring-emerald-500/40"
            : "border-neutral-800 group-hover/card:border-neutral-600")
        }
      >
        <Thumb
          src={src}
          alt={label}
          fallbackChar={label.charAt(0)}
          className={
            "h-full w-full transition-transform duration-200 group-hover/card:scale-[1.04] " +
            (selected ? "" : "opacity-90 group-hover/card:opacity-100")
          }
        />
        {isBase && (
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] text-neutral-300">
            base
          </span>
        )}
        {selected && (
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-black">
            ✓
          </span>
        )}
      </div>
      <div
        className={
          "mt-1 truncate text-center text-[11px] leading-tight " +
          (selected ? "text-emerald-200" : "text-neutral-400")
        }
      >
        {label}
      </div>
    </button>
  );
}

// ---- Generic dropdown shell -----------------------------------------------

function DropdownShell({
  icon: Icon,
  label,
  selectedLabel,
  thumb,
  isOpen,
  groupKey,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  label: string;
  selectedLabel: string;
  thumb?: React.ReactNode;
  isOpen: boolean;
  groupKey: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative" data-group={groupKey}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={
          "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors " +
          (isOpen
            ? "border-neutral-600 bg-neutral-800"
            : "border-neutral-800 bg-neutral-950 hover:border-neutral-700")
        }
      >
        <Icon className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.75} />
        {thumb}
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] uppercase tracking-wide text-neutral-500">
            {label}
          </span>
          <span className="block truncate text-xs text-neutral-200">
            {selectedLabel}
          </span>
        </span>
        <span
          className={
            "text-[10px] text-neutral-500 transition-transform " +
            (isOpen ? "rotate-180" : "")
          }
        >
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[320px] max-w-[85vw] rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-2xl shadow-black/50">
          {children}
        </div>
      )}
    </div>
  );
}

function ToggleList<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  const set = new Set(selected);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = set.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              const next = new Set(set);
              if (on) next.delete(o.value);
              else next.add(o.value);
              onChange(Array.from(next));
            }}
            className={
              "rounded border px-2 py-1 text-[11px] transition-colors " +
              (on
                ? "border-emerald-600 bg-emerald-700/40 text-emerald-100"
                : "border-neutral-800 bg-neutral-950 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300")
            }
          >
            {on ? "✓ " : ""}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PromptBuilder({
  value,
  onChange,
  previewPrompt,
  showPreview = true,
}: {
  value: PromptConfig;
  onChange: (next: PromptConfig) => void;
  previewPrompt?: string;
  showPreview?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const preview = useMemo(() => previewPrompt ?? "", [previewPrompt]);

  // Close the open dropdown when clicking outside its group, or on Escape.
  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const root = el.closest("[data-group]");
      if (!root || root.getAttribute("data-group") !== openKey) setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  const toggle = (k: string) => setOpenKey((cur) => (cur === k ? null : k));

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Visual groups → icon dropdowns with preview cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {VISUAL_GROUPS.map((g) => {
          const current = String(value[g.key] ?? "");
          const opt = g.options.find((o) => o.value === current);
          const isBaseSel = current === g.base;
          const thumbSrc = isBaseSel ? BASE_PREVIEW : previewUrl(String(g.key), current);
          return (
            <DropdownShell
              key={String(g.key)}
              groupKey={String(g.key)}
              icon={g.icon}
              label={g.label}
              selectedLabel={opt?.label ?? "—"}
              isOpen={openKey === String(g.key)}
              onToggle={() => toggle(String(g.key))}
              thumb={
                <Thumb
                  src={thumbSrc}
                  alt={opt?.label ?? ""}
                  fallbackChar={(opt?.label ?? "?").charAt(0)}
                  className="h-8 w-8 shrink-0 rounded border border-neutral-700"
                />
              }
            >
              <div className="flex flex-wrap gap-2">
                {g.options.map((o) => (
                  <PreviewCard
                    key={o.value}
                    group={String(g.key)}
                    value={o.value}
                    label={o.label}
                    hint={o.hint}
                    selected={current === o.value}
                    isBase={o.value === g.base}
                    onClick={() => {
                      onChange({ ...value, [g.key]: o.value } as PromptConfig);
                      setOpenKey(null);
                    }}
                  />
                ))}
              </div>
            </DropdownShell>
          );
        })}
      </div>

      {/* Non-visual structural knobs → icon dropdowns with a text list */}
      <div className="grid grid-cols-2 gap-2 border-t border-neutral-800 pt-3 sm:grid-cols-3">
        {TEXT_GROUPS.map((g) => {
          const current = String(value[g.key] ?? "");
          const opt = g.options.find((o) => o.value === current);
          return (
            <DropdownShell
              key={String(g.key)}
              groupKey={String(g.key)}
              icon={g.icon}
              label={g.label}
              selectedLabel={opt?.label ?? "—"}
              isOpen={openKey === String(g.key)}
              onToggle={() => toggle(String(g.key))}
            >
              <div className="flex flex-col gap-0.5">
                {g.options.map((o) => {
                  const on = current === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        onChange({ ...value, [g.key]: o.value } as PromptConfig);
                        setOpenKey(null);
                      }}
                      className={
                        "rounded px-2 py-1.5 text-left text-xs transition-colors " +
                        (on
                          ? "bg-emerald-700/40 text-emerald-100"
                          : "text-neutral-300 hover:bg-neutral-800")
                      }
                    >
                      {on ? "✓ " : ""}
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </DropdownShell>
          );
        })}
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-neutral-400">
          <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
          Preserva (vincoli forti)
        </div>
        <ToggleList
          options={PRESERVE_LIST}
          selected={value.preserve ?? []}
          onChange={(next) => onChange({ ...value, preserve: next })}
        />
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-neutral-400">
          <Ban className="h-3.5 w-3.5" strokeWidth={1.75} />
          Esclusioni (cosa NON fare)
        </div>
        <ToggleList
          options={EXCLUDE_LIST}
          selected={value.exclude ?? []}
          onChange={(next) => onChange({ ...value, exclude: next })}
        />
      </div>

      <label className="block text-xs">
        <span className="mb-1 flex items-center gap-1.5 text-neutral-400">
          <PenLine className="h-3.5 w-3.5" strokeWidth={1.75} />
          Free-form (opz.) — solo per override mirati
        </span>
        <textarea
          rows={2}
          value={value.freeform ?? ""}
          onChange={(e) => onChange({ ...value, freeform: e.target.value })}
          placeholder="es. 'enfatizza il cervo come soggetto principale'"
          className="w-full rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-sm leading-relaxed focus:border-neutral-600 focus:outline-none"
        />
      </label>

      {showPreview && preview && (
        <details className="text-xs">
          <summary className="flex cursor-pointer items-center gap-1.5 text-neutral-500 hover:text-neutral-300">
            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
            Anteprima prompt assemblato
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded border border-neutral-800 bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-300">
            {preview}
          </pre>
        </details>
      )}
    </div>
  );
}
