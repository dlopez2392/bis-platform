import { m } from "@/lib/messages";
import type { Ranked } from "@/lib/website/view-model";

const NAMES: Record<string, string> = { mobile: m["website.devices.phone"], desktop: m["website.devices.desktop"], tablet: m["website.devices.tablet"] };
// A single hue in three strengths with the sanctioned second accent as the
// tail. The third segment used to be `bg-border` — the BORDER token — so the
// tablet share read as a gap in the bar rather than a share of it.
const FILLS = [
  "bg-[var(--accent)]",
  "bg-[color-mix(in_srgb,var(--accent)_45%,transparent)]",
  "bg-[var(--accent-2)]",
];

/** One segmented bar under the chart. Single hue in three strengths, never
 *  status colours — devices are not statuses (DESIGN.md, charts). */
export function DeviceStrip({ devices }: { devices: Ranked[] }) {
  const top = devices.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div className="mt-3 flex items-center gap-4">
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--share-bg)]" role="img" aria-label={top.map((d) => `${NAMES[d.name] ?? d.name} ${Math.round(d.share * 100)}%`).join(", ")}>
        {top.map((d, i) => <span key={d.name} className={`block h-full ${FILLS[i]}`} style={{ width: `${Math.round(d.share * 100)}%` }} />)}
      </div>
      <ul className="flex gap-3" aria-hidden>
        {top.map((d, i) => (
          <li key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block size-2 rounded-[2px] ${FILLS[i]}`} />
            {NAMES[d.name] ?? d.name}
            <span className="font-mono text-[11px] text-muted-foreground/70">{Math.round(d.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
