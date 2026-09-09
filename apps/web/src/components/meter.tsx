import { cn } from "@/lib/utils";

/**
 * The progress meter, once: the mockup's `.meter` (northern-lights.html:56) —
 * 5px tall on `--meter-track`, with a violet→cyan fill. The Calls usage card
 * and the Setup progress card each had their own 6px bar on `--surface-3`
 * with a flat single-hue fill before this existed.
 *
 * The TRACK is `--meter-track`, not the sidebar's `--meter-bg`, for the same
 * reason the fill is not a sidebar token: `--meter-bg` is a white tint in
 * BOTH themes because the rail it belongs to is dark chrome in both, and on
 * a light content card (72% white) that track is invisible. It shipped that
 * way, so in light mode the Calls usage bar, the Setup progress bar and the
 * dashboard's checklist row all had no visible track at all — and at 0% the
 * fill has no width either, which left the checklist row reading as plain
 * text.
 *
 * The default fill is the CONTENT-area accent pair (`--accent`/`--accent-2`),
 * never the sidebar chrome tokens — a branded tenant re-points the accent
 * family but not `--sidebar-*`, so a shared meter painted from sidebar tokens
 * would go wrong on a themed account. The sidebar's own meter keeps its
 * chrome gradient AND its `--meter-bg` track and stays where it is (it is
 * decorative, `aria-hidden`, and `material.test.ts` pins both strings).
 *
 * `fill` overrides the gradient for a STATUS reading (near/over cap, done):
 * status is never a gradient.
 */
export const METER_TRACK = "h-[5px] w-full overflow-hidden rounded-full bg-[var(--meter-track)]";
export const METER_FILL = "bg-[linear-gradient(90deg,var(--accent),var(--accent-2))]";

export function Meter({
  percent,
  label,
  max,
  now,
  valueText,
  fill,
  className,
}: {
  /** 0-100, already clamped by the caller. */
  percent: number;
  /** `aria-label` — names what is measured, never restates the count. */
  label: string;
  max: number;
  now: number;
  valueText: string;
  /** A status fill class; omit for the sanctioned accent gradient. */
  fill?: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      data-slot="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
      aria-valuetext={valueText}
      className={cn(METER_TRACK, className)}
    >
      <div className={cn("h-full rounded-full", fill ?? METER_FILL)} style={{ width: `${percent}%` }} />
    </div>
  );
}
