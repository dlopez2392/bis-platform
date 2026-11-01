import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { tag } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Ranked } from "@/lib/website/view-model";

const DEVICE_NAME_KEYS = {
  mobile: "website.devices.phone", desktop: "website.devices.desktop", tablet: "website.devices.tablet",
} as const;

/** A ranked list: name, proportional bar, value. Bars are relative to the
 *  top row so the leader is always full width — the mockup's treatment. */
export function BreakdownPanel({
  title, rows, asShare = false, locale = "en",
}: {
  title: string;
  rows: Ranked[];
  asShare?: boolean;
  /** S-10 T2: the reader's own locale — every existing call site omits this
   *  and keeps rendering English, same as `StatTile`'s own default. */
  locale?: Locale;
}) {
  const max = rows[0]?.visitors ?? 0;
  return (
    <section className="rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-2.5" aria-label={title}>
      {/* The mockup's .panel .hd is a normal semibold heading, not the mono
          micro-label role, and each row carries a FULL-WIDTH share track under
          it rather than a 96px stub beside it (northern-lights.html:120-127). */}
      <p className="mb-2 text-[13.5px] font-semibold text-card-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t(m, "website.panel.empty", locale)}</p>
      ) : (
        <ul>
          {rows.map((r) => {
            const nameKey = (DEVICE_NAME_KEYS as Record<string, keyof typeof m>)[r.name];
            return (
              <li key={r.name} className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1.5 border-t border-[var(--row-line)] py-[7px] text-[13px] first:border-t-0">
                <span className="truncate text-card-foreground">{nameKey ? t(m, nameKey, locale) : r.name}</span>
                <span className="min-w-9 text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">
                  {asShare ? `${Math.round(r.share * 100)}%` : r.visitors.toLocaleString(tag(locale))}
                </span>
                <span className="col-span-2 h-1 overflow-hidden rounded-full bg-[var(--share-bg)]" aria-hidden>
                  <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${max > 0 ? Math.round((r.visitors / max) * 100) : 0}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
