import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RecordHeaderAction = {
  id: string; label: string; href: string; ariaLabel?: string; primary?: boolean; external?: boolean;
};

/**
 * The record page's header (spec §9.1). The name is the page's h1 (Display 600, 22px). Under it,
 * muted, the main group as plain text (C7). The actions follow in the order given, with the one
 * primary first on every width; each is at least 44px tall, and they wrap rather than clip.
 */
export function RecordHeader({ name, subtitle, back, actions }: {
  name: string; subtitle?: string | null; back: { href: string; label: string }; actions: RecordHeaderAction[];
}) {
  return (
    <header data-record-header className="min-w-0 space-y-1.5">
      <Link href={back.href}
        className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-ctl)] text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
        <ChevronLeft className="size-4" aria-hidden />
        {back.label}
      </Link>
      <h1 title={name} className="truncate text-[22px] font-display font-[600] tracking-[-0.02em] text-card-foreground">{name}</h1>
      {subtitle ? <p data-record-subtitle className="text-sm text-muted-foreground">{subtitle}</p> : null}
      {actions.length > 0 ? (
        <div data-record-actions className="flex flex-wrap gap-2 pt-2">
          {actions.map((a) => (
            <Button key={a.id} asChild variant={a.primary ? "default" : "ghost"} className="min-h-11" data-record-action={a.id}>
              <a href={a.href} aria-label={a.ariaLabel} {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}>
                {a.label}
              </a>
            </Button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
