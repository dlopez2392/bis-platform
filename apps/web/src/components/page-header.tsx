import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  tabs,
  selector,
  count,
  actions,
  filters,
  search,
  className,
}: {
  title: string;
  /** One line under the title — the dashboard greeting's date/voice line.
   *  Lives inside the head so the whole block is one bare column over the
   *  aurora rather than a second hand-rolled slab beside this component. */
  subtitle?: React.ReactNode;
  tabs?: React.ReactNode;
  selector?: React.ReactNode;
  count?: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  search?: React.ReactNode;
  className?: string;
}) {
  const hasRow2 = Boolean(selector || count || actions);
  const hasRow3 = Boolean(filters || search);
  return (
    // The mockup's `.page-head` (northern-lights.html:68) is a BARE flex row
    // inside `.content` (line 67, `padding: 22px 24px 24px`) — no fill, no
    // border, no rule. The opaque `--surface-1` slab that used to live here
    // painted across the top of all 14 routes, exactly where the ground's
    // brightest glow (`12% -10%`) lands, so the aurora never touched the top
    // of any screen in the app.
    <div className={cn(className)}>
      <div className="flex items-center gap-6 px-6 pt-[22px]">
        <h1 className="text-[22px] font-display font-[600] tracking-[-0.02em] text-card-foreground">
          {title}
        </h1>
        {tabs}
      </div>

      {subtitle ? <p className="mt-1 px-6 text-sm text-muted-foreground">{subtitle}</p> : null}

      {hasRow2 ? (
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          {selector}
          {count ? (
            <Badge variant="secondary" className="font-normal">
              {count}
            </Badge>
          ) : null}
          {/* F-107 (rider part): `flex-wrap` on `actions` itself, not just
              on this row — a page with several actions (contacts' Export
              CSV / Import CSV / Add contact is the first with three) is one
              un-wrapping flex row of `shrink-0 whitespace-nowrap` buttons
              (components/ui/button.tsx), so wrapping only the ROW let the
              whole block drop to its own line but never let it shrink
              narrower than every button laid end to end — at phone width
              that was still wider than the page. Wrapping here lets the
              buttons stack instead. */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>
        </div>
      ) : (
        <div className="h-5" />
      )}

      {hasRow3 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--row-line)] px-6 py-3">
          {filters}
          {/* F-107 (rider part): `min-w-0` — same reasoning as `actions`
              above: this flex item's automatic minimum size otherwise
              floors at whatever fixed width a caller's own search input
              carries (contacts/page.tsx's is 288px), which held this row
              open past the page at phone width regardless of wrapping. */}
          <div className="ml-auto min-w-0">{search}</div>
        </div>
      ) : null}
    </div>
  );
}
