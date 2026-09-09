import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  tabs,
  selector,
  count,
  actions,
  filters,
  search,
  className,
}: {
  title: string;
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
    <div className={cn("border-b border-border bg-card", className)}>
      <div className="flex items-center gap-6 px-6 pt-5">
        <h1 className="text-[22px] font-display font-[600] tracking-[-0.02em] text-card-foreground">
          {title}
        </h1>
        {tabs}
      </div>

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
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
          {filters}
          <div className="ml-auto">{search}</div>
        </div>
      ) : null}
    </div>
  );
}
