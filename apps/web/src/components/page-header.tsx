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
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      ) : (
        <div className="h-5" />
      )}

      {hasRow3 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--row-line)] px-6 py-3">
          {filters}
          <div className="ml-auto">{search}</div>
        </div>
      ) : null}
    </div>
  );
}
