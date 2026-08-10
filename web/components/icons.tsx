/**
 * The icon set.
 *
 * Before this module the app carried 59 inline <svg> blocks covering about 25
 * distinct symbols — the bag was redrawn six separate times, the close X four,
 * the avatar three. Each copy drifted: thirteen different stroke widths across
 * six different viewBox grids, and because a stroke on a 24-unit grid scales
 * with the rendered size, the heaviest icon in the app drew a line 2.2× thicker
 * than the lightest. That inconsistency is the single most obvious tell of an
 * ad-hoc icon set, and no amount of spacing or colour work compensates for it.
 *
 * Two rules fix it, and this module exists to make them unbreakable:
 *
 *   1. One grid. Every path is drawn on 24×24 with a 2-unit safe margin, so
 *      shapes optically align when set side by side at any size.
 *   2. One optical weight. STROKE_PX is the stroke in *rendered* pixels, and
 *      the primitive divides it back through the render size. A 12px icon and a
 *      30px icon therefore draw exactly the same line weight — which is what
 *      makes a set read as drawn rather than assembled.
 *
 * Geometry is deliberately plain: no filled shapes except where the symbol
 * genuinely needs mass, round caps and joins throughout, and curvature reserved
 * for forms that are actually round. Add icons here, never inline.
 */
import * as React from 'react'

/** Stroke weight in rendered pixels, identical at every size. Chosen to sit on
 *  the old set's median (1.19px) so this reads as the same app tidied up, not
 *  a restyle. */
const STROKE_PX = 1.25

const GRID = 24

export interface IconProps {
  /** Rendered size in px. Stroke compensates automatically. */
  size?: number
  /** Any CSS colour; defaults to the inherited text colour. */
  color?: string
  /** Escape hatch for a deliberately heavier or lighter cut. */
  strokePx?: number
  className?: string
  style?: React.CSSProperties
  'aria-label'?: string
}

/** Shared chrome for every icon below. Decorative by default — pass aria-label
 *  only when the icon is the sole carrier of meaning. */
function Svg({
  size = 16, color = 'currentColor', strokePx = STROKE_PX,
  className, style, children, ...rest
}: IconProps & { children: React.ReactNode }) {
  const label = rest['aria-label']
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}
      fill="none"
      stroke={color}
      strokeWidth={+(strokePx * GRID / size).toFixed(3)}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {label ? <title>{label}</title> : null}
      {children}
    </svg>
  )
}

/* ── Commerce ─────────────────────────────────────────────────────────────── */

/** Tote. Straight body with a soft base radius and a shallow handle arc — the
 *  six inline copies each had a different handle curvature. */
export const BagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 8h13l-1 11.5a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8Z" />
    <path d="M9 8V6.6a3 3 0 0 1 6 0V8" />
  </Svg>
)

export const TagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.2 11.4V4.4a1.2 1.2 0 0 1 1.2-1.2h7l9.4 9.4a1.2 1.2 0 0 1 0 1.7l-6 6a1.2 1.2 0 0 1-1.7 0Z" />
    <circle cx="7.7" cy="7.7" r="1.35" />
  </Svg>
)

/* ── People ───────────────────────────────────────────────────────────────── */

/** Avatar. Head and shoulders share one optical centre; the three inline copies
 *  each sat the head at a different height. */
export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M4.6 20.4a7.6 7.6 0 0 1 14.8 0" />
  </Svg>
)

/* The gender picker's two options. They are only ever shown side by side, so
 * they are drawn as a matched pair: identical head size and position, identical
 * shoulder width, and the same overall height — the silhouette below the
 * shoulders is the only thing that differs. Previously these were two unrelated
 * inline drawings (a shoulders arc and a bare triangle) that shared neither
 * proportion nor weight, which is why the pair looked mismatched. */

/** Straight-hemmed torso. */
export const FigureMasculineIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="5.1" r="2.5" />
    <path d="M9.5 9.2h5l1.5 2.1v8.7a.9.9 0 0 1-.9.9H8.9a.9.9 0 0 1-.9-.9v-8.7Z" />
  </Svg>
)

/** Flared hem, same head and shoulders. */
export const FigureFeminineIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="5.1" r="2.5" />
    <path d="M9.5 9.2h5l2.6 10.7a.8.8 0 0 1-.8 1H7.7a.8.8 0 0 1-.8-1Z" />
  </Svg>
)

/* ── Actions ──────────────────────────────────────────────────────────────── */

/** Close. One geometry for every dismissal in the app — there were four. */
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
  </Svg>
)

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 5.2v13.6M5.2 12h13.6" /></Svg>
)

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 12.4 9.6 17 19 7.4" /></Svg>
)

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 6.6h14.8" />
    <path d="M9.4 6.6V5.2a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.4" />
    <path d="M6.6 6.6 7.5 19a1.8 1.8 0 0 0 1.8 1.7h5.4a1.8 1.8 0 0 0 1.8-1.7l.9-12.4" />
    <path d="M10.6 10.4v6.2M13.4 10.4v6.2" />
  </Svg>
)

/** Pencil. Nib, shaft and a separate baseline, so it stays legible at 12px
 *  where a single outlined quill turns to mush. */
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.7 4.6a1.9 1.9 0 0 1 2.7 2.7L9.2 16.5l-3.6.9.9-3.6Z" />
    <path d="M4.6 20.6h14.8" />
  </Svg>
)

export const ExternalLinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.4 5.2H6.4a1.8 1.8 0 0 0-1.8 1.8v10.6a1.8 1.8 0 0 0 1.8 1.8H17a1.8 1.8 0 0 0 1.8-1.8v-7" />
    <path d="M11.2 12.8 19.4 4.6" />
    <path d="M14.6 4.6h4.8v4.8" />
  </Svg>
)

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.2" />
    <path d="M15.4 15.4l4 4" />
  </Svg>
)

/* ── Content ──────────────────────────────────────────────────────────────── */

/** Image. The frame is a true rounded square; the three inline copies used
 *  three different corner radii. */
export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.2" />
    <circle cx="9" cy="9.8" r="1.5" />
    <path d="M4.2 16.6 9 12.4l3.4 3 3-2.4 4.4 3.9" />
  </Svg>
)

export const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 8.4h3l1.4-2.2h6.4l1.4 2.2h3a1.4 1.4 0 0 1 1.4 1.4v8a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 17.8v-8a1.4 1.4 0 0 1 1.4-1.4Z" />
    <circle cx="12" cy="13.4" r="3.4" />
  </Svg>
)

export const DocumentIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.4 3.4H7a1.8 1.8 0 0 0-1.8 1.8v13.6A1.8 1.8 0 0 0 7 20.6h10a1.8 1.8 0 0 0 1.8-1.8V8.8Z" />
    <path d="M13.4 3.4v5.4h5.4" />
    <path d="M8.8 13h6.4M8.8 16.2h4.2" />
  </Svg>
)

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2 19.4 6v6c0 4.6-3.2 7.6-7.4 9.2C7.8 19.6 4.6 16.6 4.6 12V6Z" />
  </Svg>
)

/** Four-point sparkle — the "AI / picked for you" mark. Concave sides, so it
 *  reads as a glint rather than a plus sign. */
export const SparkleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4c.5 4.2 1.9 5.6 6.1 6.1-4.2.5-5.6 1.9-6.1 6.1-.5-4.2-1.9-5.6-6.1-6.1 4.2-.5 5.6-1.9 6.1-6.1Z" />
    <path d="M17.6 15.6c.25 2 .95 2.7 2.9 2.95-1.95.25-2.65.95-2.9 2.95-.25-2-.95-2.7-2.9-2.95 1.95-.25 2.65-.95 2.9-2.95Z" />
  </Svg>
)

/* ── Navigation ───────────────────────────────────────────────────────────── */

/** One chevron, rotated — the app previously drew separate up/down/left/right
 *  polylines whose arm lengths didn't match. */
export const ChevronIcon = ({ dir = 'down', ...p }: IconProps & { dir?: 'up' | 'down' | 'left' | 'right' }) => {
  const deg = { up: 180, right: 270, down: 0, left: 90 }[dir]
  return (
    <Svg {...p} style={{ ...p.style, transform: `rotate(${deg}deg)` }}>
      <path d="M6.6 9.6 12 15l5.4-5.4" />
    </Svg>
  )
}

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4.4 7.2h15.2M4.4 12h15.2M4.4 16.8h15.2" /></Svg>
)

export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.4 8.4h15.2M4.4 15.6h15.2" />
    <circle cx="9.4" cy="8.4" r="2.1" />
    <circle cx="15" cy="15.6" r="2.1" />
  </Svg>
)

export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.6" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="18.4" cy="12" r="1.15" fill="currentColor" stroke="none" />
  </Svg>
)

/** Indeterminate spinner. The gap is the affordance, so it must stay an open
 *  arc — a full ring reads as static at small sizes. */
export const SpinnerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.2a7.8 7.8 0 1 1-5.5 2.3" />
  </Svg>
)

/** Save / wishlist. `filled` is the saved state — the outline and the fill share
 *  one path so the shape doesn't shift when it toggles. */
export const HeartIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="M12 20.4 4.9 13.3a4.5 4.5 0 0 1 6.4-6.3l.7.7.7-.7a4.5 4.5 0 0 1 6.4 6.3Z"
      fill={filled ? (p.color ?? 'currentColor') : 'none'}
    />
  </Svg>
)

/** Recents — a clock whose ring opens into a counter-clockwise arrow. */
export const HistoryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.8 12a8.2 8.2 0 1 0 2.7-6.1" />
    <path d="M3.6 4.4v4h4" />
    <path d="M12 7.8V12l3 1.8" />
  </Svg>
)

export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19.2V5.4" />
    <path d="M5.9 11.5 12 5.4l6.1 6.1" />
  </Svg>
)

/* ── The search, step by step ─────────────────────────────────────────────────
   One icon per stage the stylist actually reports, drawn in the same 24-grid
   1.25px cut as everything above. They are specific to what is happening —
   reading, going through rails, narrowing, judging, assembling — rather than a
   generic spinner repeated five times, because the point of showing the steps
   is that they are different steps.                                          */

/** Reading the request. A line of text with its last word still being taken in. */
export function ReadingIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h11" />
      <path d="M4 17h5" />
      <circle cx="17.5" cy="16.5" r="2.6" />
    </Svg>
  )
}

/** Going through the rails. A hanging rail with two garments on it. */
export function RailIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 5h18" />
      <path d="M8.5 5v2.2" />
      <path d="M8.5 7.2 5.6 10.4V19h5.8v-8.6L8.5 7.2Z" />
      <path d="M16 5v2.2" />
      <path d="M16 7.2l-2.2 2.6" />
      <path d="M18.2 9.8 16 7.2" />
      <path d="M13.8 9.8V19h4.4V9.8" />
    </Svg>
  )
}

/** Narrowing. A funnel — what goes in is more than what comes out. */
export function NarrowIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 5h17l-6.6 7.6V20l-3.8-2.4v-5L3.5 5Z" />
    </Svg>
  )
}

/** Judging a piece. An eye, because this stage is somebody looking. */
export function AppraiseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </Svg>
  )
}

/** Judging the cloth. A swatch with its weave shown. */
export function SwatchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 4.5h15v15h-15z" />
      <path d="M4.5 9.5h15M4.5 14.5h15M9.5 4.5v15M14.5 4.5v15" />
    </Svg>
  )
}

/** Putting the look together. Three pieces stacking into one. */
export function AssembleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z" />
      <path d="M3.5 12 12 16.5 20.5 12" />
      <path d="M3.5 16.5 12 21l8.5-4.5" />
    </Svg>
  )
}
