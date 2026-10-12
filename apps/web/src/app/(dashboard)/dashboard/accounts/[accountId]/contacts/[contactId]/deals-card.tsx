import { formatCurrency } from "@/lib/format";
import type { Tr } from "@/lib/record/copy";

export type DealRow = { id: string; name: string; status: string; monetary_value: number | string };

const STATUS = {
  open: { key: "pipeline.status.open", dot: "bg-[var(--accent)]" },
  won: { key: "pipeline.status.won", dot: "bg-[var(--good)]" },
  lost: { key: "pipeline.status.lost", dot: "bg-[var(--text-3)]" },
} as const;

/** Deals (spec §9.5, C10): today's rows, now with a dot on the status word, in the page's language. */
export function DealsBody({ deals, tr }: { deals: DealRow[]; tr: Tr }) {
  if (deals.length === 0) return <p className="text-sm text-muted-foreground">{tr.text("contact.noOpportunities")}</p>;
  return (
    <ul className="flex flex-col text-sm">
      {deals.map((o) => {
        const s = STATUS[o.status as keyof typeof STATUS];
        return (
          <li key={o.id} className="border-t border-[var(--row-line)] py-[7px] first:border-t-0">
            <p className="truncate font-medium" title={o.name}>{o.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              {formatCurrency(Number(o.monetary_value), tr.locale)} ·
              <span data-deal-status={o.status} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-[7px] shrink-0 rounded-full ${s?.dot ?? "bg-[var(--text-3)]"}`} />
                <span>{s ? tr.text(s.key) : o.status}</span>
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
