import Link from "next/link";
import { m } from "@/lib/messages";
import { withWho, type Who } from "@/lib/assign/who";
import { cn } from "@/lib/utils";

/**
 * "All · Mine · Unassigned" (spec §9). Plain links, not client state: the
 * filter runs on the server, so the cursor pager and the header's real total
 * stay true (DESIGN.md Paged lists). `params` is what each link carries
 * along (search, sort): never `before`, so a filter change returns to page
 * one. Mine needs a person of this company; the agency never is one, so it
 * gets All and Unassigned only (`showMine`).
 *
 * A pill per link (the 999px shape), the sidebar's active treatment for the
 * current one, `--surface-3` on hover. It wraps rather than overflow at
 * phone width, the pseudo-locale's +35% included.
 */
export function WhoFilter({ base, current, showMine, params }: {
  base: string;
  /** `null` (Task 12 review, coordinator round 1): the page this filter sits
   *  on is showing something ELSE entirely (the "Needs a look" held-email
   *  list) — none of All/Mine/Unassigned is the page the reader is on, so
   *  none of them may claim `aria-current="page"`. */
  current: Who | null;
  showMine: boolean;
  params: Record<string, string>;
}) {
  const items: { who: Who; label: string }[] = [
    { who: "all", label: m["assign.filter.all"] },
    ...(showMine ? [{ who: "mine" as const, label: m["assign.filter.mine"] }] : []),
    { who: "unassigned", label: m["assign.unassigned"] },
  ];
  return (
    <nav aria-label={m["assign.filter.label"]} className="flex min-w-0 flex-wrap items-center gap-1">
      {items.map((i) => {
        const qs = new URLSearchParams(withWho(params, i.who)).toString();
        const active = current === i.who;
        return (
          <Link
            key={i.who}
            href={qs ? `${base}?${qs}` : base}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active ? "bg-[var(--accent-dim)] font-medium text-foreground" : "text-muted-foreground hover:bg-[var(--surface-3)] hover:text-foreground",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
