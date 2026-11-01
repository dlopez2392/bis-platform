import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { Ranked } from "@/lib/website/view-model";

const NAME_KEYS = {
  mobile: "website.devices.phone", desktop: "website.devices.desktop", tablet: "website.devices.tablet",
} as const;
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
export function DeviceStrip({ devices, locale = "en" }: {
  devices: Ranked[];
  /** S-10 T2: the reader's own locale — every existing call site omits this
   *  and keeps rendering English, same as `StatTile`'s own default. */
  locale?: Locale;
}) {
  const top = devices.slice(0, 3);
  if (top.length === 0) return null;
  const name = (n: string) => {
    const key = (NAME_KEYS as Record<string, keyof typeof m>)[n];
    return key ? t(m, key, locale) : n;
  };
  return (
    <div className="mt-3 flex items-center gap-4">
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--share-bg)]" role="img" aria-label={top.map((d) => `${name(d.name)} ${Math.round(d.share * 100)}%`).join(", ")}>
        {top.map((d, i) => <span key={d.name} className={`block h-full ${FILLS[i]}`} style={{ width: `${Math.round(d.share * 100)}%` }} />)}
      </div>
      {/* F-107 (rider part, outside this rider's own ownership — flagged in
          its report): `flex-wrap` — three legend items with no wrap set a
          combined, unshrinkable minimum width this row's flex-1 bar could
          not make up for by shrinking alone. */}
      <ul className="flex flex-wrap gap-3" aria-hidden>
        {top.map((d, i) => (
          <li key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block size-2 rounded-[2px] ${FILLS[i]}`} />
            {name(d.name)}
            <span className="font-mono text-[11px] text-muted-foreground/70">{Math.round(d.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
