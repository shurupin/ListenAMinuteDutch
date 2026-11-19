// Media icons as SVG: text glyphs (▶ ⏸ ↺) carry font-specific side bearings and some
// render as emoji, so they never sit exactly centred in a round button. Every shape
// below has its bounding box centred in the 24×24 viewBox (centre = 12,12).
import type { ComponentChildren } from 'preact';

function Svg({ size, children }: { size: number; children: ComponentChildren }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="ico">
      {children}
    </svg>
  );
}

type P = { size?: number };

/** Triangle, bbox x 7.5..19.5, y 4.5..19.5 — shifted 1.5 right of the geometric centre
 *  on purpose: a triangle's mass sits at its left side, so this looks centred. */
export const IconPlay = ({ size = 14 }: P) => <Svg size={size}><path d="M7.5 4.5 19.5 12 7.5 19.5Z" /></Svg>;

/** Two bars, bbox x 6.5..17.5, y 5..19. */
export const IconPause = ({ size = 14 }: P) => (
  <Svg size={size}><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></Svg>
);

/** Circular arrow ("replay"), bbox x 4..20, y 2..22. */
export const IconRestart = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M12 6V2L7 7l5 5V8c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
  </Svg>
);

/** Bar + triangle, bbox x 6..18, y 6..18. */
export const IconPrev = ({ size = 14 }: P) => <Svg size={size}><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></Svg>;
export const IconNext = ({ size = 14 }: P) => <Svg size={size}><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></Svg>;

/** Loop arrows, bbox x 3..21, y 2..22. */
export const IconRepeat = ({ size = 14 }: P) => (
  <Svg size={size}><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /></Svg>
);

/** Dropdown chevron (stroke), bbox x 7..17, y 9.5..14.5. */
export const IconChevron = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ico">
    <path d="M7 9.5l5 5 5-5" />
  </svg>
);

/** Minus / plus bars, bbox x 6..18, y 11..13 (plus: also x 11..13, y 6..18). */
export const IconMinus = ({ size = 14 }: P) => <Svg size={size}><rect x="6" y="11" width="12" height="2" rx="1" /></Svg>;
export const IconPlus = ({ size = 14 }: P) => (
  <Svg size={size}><rect x="6" y="11" width="12" height="2" rx="1" /><rect x="11" y="6" width="2" height="12" rx="1" /></Svg>
);

/** Star, bbox x 2..22, y 2..21 shifted +0.5 so it is centred at y 12. */
export const IconStar = ({ size = 14, filled = false }: P & { filled?: boolean }) => (
  <Svg size={size}>
    <g transform="translate(0 0.5)">
      {filled ? (
        <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      ) : (
        <path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z" />
      )}
    </g>
  </Svg>
);
