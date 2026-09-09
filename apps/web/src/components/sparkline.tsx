// apps/web/src/components/sparkline.tsx
//
// Decorative trend line for a StatTile (Task 4). Geometry comes from
// `sparklinePath` in `@/lib/dashboard/metrics` — this component renders
// that geometry, it never recomputes it. Viewbox and stroke/dot treatment
// are pinned by the mockup (`docs/design/bis-design-direction.html`, the
// `.spark` SVGs around lines 315-321): 100x26, `preserveAspectRatio="none"`
// so the line stretches to fill its container. stroke-width 1.8, endpoint
// dot r 2.4, area fill at 14% opacity (Northern Lights spec §5).
import { sparklinePath } from "@/lib/dashboard/metrics";

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 26;

/**
 * Purely decorative — the tile's value and delta already carry the
 * information a sighted reader gets from the trend line, so this is
 * `aria-hidden` at the component level rather than leaving callers to
 * remember it.
 */
export function Sparkline({ counts, className }: { counts: number[]; className?: string }) {
  const { line, area, endX, endY } = sparklinePath(counts, VIEW_WIDTH, VIEW_HEIGHT);
  if (!line) return null;

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <polygon points={area} fill="currentColor" opacity={0.14} />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.8} />
      <circle cx={endX} cy={endY} r={2.4} fill="currentColor" />
    </svg>
  );
}
