import { formatCurrency } from "@/lib/format";
import type { Tr } from "@/lib/record/copy";

/** `who`: the person a group page's row belongs to (S-03 part 2, C13), their name as typed. */
export type DealRow = { id: string; name: string; status: string; monetary_value: number | string; who?: string };

const STATUS = {
  open: { key: "pipeline.status.open", dot: "bg-[var(--accent)]" },
  won: { key: "pipeline.status.won", dot: "bg-[var(--good)]" },
  lost: { key: "pipeline.status.lost", dot: "bg-[var(--text-3)]" },
} as const;

/**
 * Deals (spec §9.5, C10): today's rows, now with a dot on the status word, in the page's language.
 * The group page (S-03 part 2, §8.5) adds each row's person, its own empty text and the
 * "Showing 30 of 41" line; without them the contact page's markup is unchanged.
 */
export function DealsBody({ deals, tr, emptyText, moreText }: {
  deals: DealRow[]; tr: Tr; emptyText?: string; moreText?: string | null;
}) {
  if (deals.length === 0) return <p className="text-sm text-muted-foreground">{emptyText ?? tr.text("contact.noOpportunities")}</p>;
  return (
    <>
      <ul className="flex flex-col text-sm">
        {deals.map((o) => {
          const s = STATUS[o.status as keyof typeof STATUS];
          return (
            <li key={o.id} className="border-t border-[var(--row-line)] py-[7px] first:border-t-0">
              <p className="truncate font-medium" title={o.name}>{o.name}</p>
              {o.who ? <p data-deal-who className="truncate text-xs text-muted-foreground" title={o.who}>{o.who}</p> : null}
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
      {moreText ? <p data-deals-more className="pt-1 text-xs text-muted-foreground">{moreText}</p> : null}
    </>
  );
}
