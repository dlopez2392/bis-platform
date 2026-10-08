import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  /** Additive, optional: a caller that needs to hide this whole state at a
   *  breakpoint (conversations/page.tsx's mobile "pick a thread" pane,
   *  D-021) merges its own utility classes in rather than wrapping the
   *  component in an extra div just to add `hidden lg:flex`. */
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-[radial-gradient(420px_220px_at_0%_0%,var(--accent-dim),transparent_70%)] px-6 py-16 text-center", className)}>
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium text-foreground">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}
