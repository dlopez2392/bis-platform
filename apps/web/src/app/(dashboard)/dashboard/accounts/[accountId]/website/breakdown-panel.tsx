import { m } from "@/lib/messages";
import type { Ranked } from "@/lib/website/view-model";

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const DEVICE_NAMES: Record<string, string> = {
  mobile: m["website.devices.phone"], desktop: m["website.devices.desktop"], tablet: m["website.devices.tablet"],
};

/** A ranked list: name, proportional bar, value. Bars are relative to the
 *  top row so the leader is always full width — the mockup's treatment. */
export function BreakdownPanel({ title, rows, asShare = false }: { title: string; rows: Ranked[]; asShare?: boolean }) {
  const max = rows[0]?.visitors ?? 0;
  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-label={title}>
      <p className={LABEL}>{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{m["website.panel.empty"]}</p>
      ) : (
        <ul className="mt-2">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 truncate text-sm text-card-foreground">{DEVICE_NAMES[r.name] ?? r.name}</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-accent" aria-hidden>
                <span className="block h-full rounded-full bg-primary" style={{ width: `${max > 0 ? Math.round((r.visitors / max) * 100) : 0}%` }} />
              </span>
              <span className="min-w-9 text-right font-mono text-xs font-medium tabular-nums text-muted-foreground">
                {asShare ? `${Math.round(r.share * 100)}%` : r.visitors.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
