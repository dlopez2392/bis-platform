import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RecordHeaderAction = {
  id: string; label: string; href: string; ariaLabel?: string; primary?: boolean; external?: boolean;
};

/**
 * The record's header (spec §9.1). On the page the name is its h1 (Display 600, 22px) under a back
 * link. In the list's drawer (S-03 part 3 §8.1) there is no back link, the name is an h2 (a dialog
 * over a page that has its own h1 holds no second one) wrapped by the Sheet's title, and `trailing`
 * (the ↗ to the full record) sits beside it and never shrinks. Under the name, muted, the main group.
 * The actions follow in the order given, the one primary first; each at least 44px tall; they wrap.
 */
export function RecordHeader({ name, subtitle, subtitleHref, back, actions, headingLevel = 1, wrapHeading, trailing }: {
  name: string; subtitle?: string | null; subtitleHref?: string;
  back?: { href: string; label: string };
  actions: RecordHeaderAction[];
  headingLevel?: 1 | 2;
  wrapHeading?: (heading: ReactElement) => ReactNode;
  trailing?: ReactNode;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  const heading = (
    <Heading title={name} className="min-w-0 truncate text-[22px] font-display font-[600] tracking-[-0.02em] text-card-foreground">{name}</Heading>
  );
  const named = wrapHeading ? wrapHeading(heading) : heading;
  return (
    <header data-record-header className="min-w-0 space-y-1.5">
      {back ? (
        <Link href={back.href}
          className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-ctl)] text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      {trailing ? (
        <div data-record-name-line className="flex min-w-0 items-center gap-2">
          {named}<span className="shrink-0">{trailing}</span>
        </div>
      ) : named}
      {subtitle ? (
        subtitleHref ? (
          <Link href={subtitleHref} data-record-subtitle
            className="block w-fit rounded-[var(--radius-ctl)] text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {subtitle}
          </Link>
        ) : <p data-record-subtitle className="text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
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
