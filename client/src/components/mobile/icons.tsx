import type { SVGProps } from "react";
import type { GradeStepType } from "../../api";

// Line-icon set for the mobile editor — no emoji anywhere. Every icon is a
// single 24×24 stroke drawing that inherits `currentColor`, so it tints with
// the surrounding text just like the rest of the UI.
type IconProps = { className?: string };

function svg(className: string): SVGProps<SVGSVGElement> {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
  };
}

// ---- per-step icons -------------------------------------------------------

export function StepIcon({
  type,
  className = "w-5 h-5",
}: {
  type: GradeStepType;
  className?: string;
}) {
  switch (type) {
    case "white_balance": // half-lit disc = white balance / contrast
      return (
        <svg {...svg(className)}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "levels": // histogram bars
      return (
        <svg {...svg(className)}>
          <rect x="4" y="12" width="3.4" height="8" rx="1" />
          <rect x="10.3" y="6" width="3.4" height="14" rx="1" />
          <rect x="16.6" y="9.5" width="3.4" height="10.5" rx="1" />
        </svg>
      );
    case "sakura": // five-petal blossom
      return (
        <svg {...svg(className)}>
          <circle cx="12" cy="6.6" r="2.5" />
          <circle cx="17" cy="10.2" r="2.5" />
          <circle cx="15.1" cy="16.1" r="2.5" />
          <circle cx="8.9" cy="16.1" r="2.5" />
          <circle cx="7" cy="10.2" r="2.5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      );
    case "sky": // sun with rays
      return (
        <svg {...svg(className)}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
        </svg>
      );
    case "lut": // stacked layers
      return (
        <svg {...svg(className)}>
          <path d="M12 3 21 8l-9 5-9-5 9-5Z" />
          <path d="M3 13l9 5 9-5" />
          <path d="M3 16.5l9 5 9-5" opacity="0.5" />
        </svg>
      );
    case "color": // tone sliders
      return (
        <svg {...svg(className)}>
          <path d="M4 7h16M4 12h16M4 17h16" />
          <circle cx="9" cy="7" r="2.1" fill="currentColor" />
          <circle cx="15" cy="12" r="2.1" fill="currentColor" />
          <circle cx="8" cy="17" r="2.1" fill="currentColor" />
        </svg>
      );
    case "hsl": // color wheel
      return (
        <svg {...svg(className)}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4v16M4.5 8l15 8M4.5 16l15-8" />
          <circle cx="12" cy="12" r="2.4" />
        </svg>
      );
    case "curve": // tone curve in a frame
      return (
        <svg {...svg(className)}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
          <path d="M5 19c5 0 4-14 14-14" />
        </svg>
      );
    case "split_tone": // three overlapping color circles
      return (
        <svg {...svg(className)}>
          <circle cx="9" cy="9.5" r="5" />
          <circle cx="15" cy="9.5" r="5" />
          <circle cx="12" cy="15" r="5" />
        </svg>
      );
    case "ai": // sparkle (outline, not the emoji)
      return (
        <svg {...svg(className)}>
          <path d="M12 4c.6 3.8 1.6 4.8 5.4 5.4-3.8.6-4.8 1.6-5.4 5.4-.6-3.8-1.6-4.8-5.4-5.4C10.4 8.8 11.4 7.8 12 4Z" />
          <path d="M18.5 15c.25 1.6.7 2.05 2.3 2.3-1.6.25-2.05.7-2.3 2.3-.25-1.6-.7-2.05-2.3-2.3 1.6-.25 2.05-.7 2.3-2.3Z" />
        </svg>
      );
    default:
      return (
        <svg {...svg(className)}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

// ---- utility icons --------------------------------------------------------

export const IconClose = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconPlus = ({ className = "w-5 h-5" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconChevronLeft = ({ className = "w-5 h-5" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export const IconChevronRight = ({ className = "w-5 h-5" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconInfo = ({ className = "w-5 h-5" }: IconProps) => (
  <svg {...svg(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export const IconShieldCheck = ({ className = "w-5 h-5" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const IconText = ({ className = "w-5 h-5" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M9 12h6M9 16h4" />
  </svg>
);

export const IconChevronUp = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M6 15l6-6 6 6" />
  </svg>
);

export const IconChevronDown = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconTrash = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
  </svg>
);

export const IconReset = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M4 9a8 8 0 1 1-1.5 5" />
    <path d="M4 4v5h5" />
  </svg>
);

export const IconUndo = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h11a5 5 0 0 1 0 10h-2" />
  </svg>
);

export const IconRedo = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="m15 7 5 5-5 5" />
    <path d="M20 12H9a5 5 0 0 0 0 10h2" />
  </svg>
);

export const IconCompare = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <rect x="3.5" y="6" width="17" height="12" rx="1.5" />
    <path d="M12 6v12" />
    <path d="M12 9.5 9 12l3 2.5" />
  </svg>
);

export const IconRefresh = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M20 11a8 8 0 1 0-2.3 6" />
    <path d="M20 5v6h-6" />
  </svg>
);

export const IconBookmark = ({ className = "w-5 h-5" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M6 4h12v16l-6-4-6 4V4Z" />
  </svg>
);

// Stacked cards = versions / generations of the same photo.
export const IconLayers = ({ className = "w-5 h-5" }: IconProps) => (
  <svg {...svg(className)}>
    <rect x="4" y="4" width="12" height="12" rx="1.5" />
    <path d="M8 20h10a2 2 0 0 0 2-2V8" />
  </svg>
);

// Two columns of dots = drag handle for reordering pipeline steps.
export const IconGrip = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconDownload = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M12 4v11M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </svg>
);

export const IconUpload = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M12 20V9M8 12l4-4 4 4" />
    <path d="M5 5h14" />
  </svg>
);

export const IconPencil = ({ className = "w-4 h-4" }: IconProps) => (
  <svg {...svg(className)}>
    <path d="M14 6l4 4M4 20l1-4L16 5a1.5 1.5 0 0 1 2 0l1 1a1.5 1.5 0 0 1 0 2L8 19l-4 1Z" />
  </svg>
);
