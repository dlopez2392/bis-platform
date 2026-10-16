import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
  lang,
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
  /** Additive, optional (Task 12 review): a caller rendering this in a
   *  locale other than the surrounding page's own `<html lang>` (the held
   *  queue's empty state, in Spanish) sets it here instead of a wrapping
   *  div, so a screen reader and the pseudo-locale sweep both read it
   *  correctly (DESIGN.md DoD: sets `lang` correctly). */
  lang?: string;
}) {
  return (
    <div lang={lang} className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-[radial-gradient(420px_220px_at_0%_0%,var(--accent-dim),transparent_70%)] px-6 py-16 text-center", className)}>
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium text-foreground">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}
