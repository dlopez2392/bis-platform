// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/textback-failed-badge.tsx
//
// "Text-back didn't send" — dot + word (DESIGN.md rule 3: status is never
// colour alone), shared by the calls list row (calls-table.tsx) and the call
// detail page ([callId]/page.tsx) so the badge a client clicks in the list is
// byte-identical to the one that greets them on the other side. Same reason
// `OutcomePill` next door exists rather than a second copy of its JSX.
//
// The hue lives in the DOT and the chip's border, never in the label text —
// the same rule `OUTCOMES` (format.ts) documents, and the one a live AA sweep
// already caught this repo breaking once: `--destructive` as TEXT measures
// under AA on the dark ramp. `text-foreground` reads in both themes.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr } from "@/lib/record/copy";

/** `locale` defaults to English: this badge's two callers (the list row,
 *  the detail page) both now pass their own real locale (S-10 T5); the
 *  default only protects a future caller that forgets to. */
export function TextbackFailedBadge({ className, locale = "en", pseudo = false }: { className?: string; locale?: Locale; pseudo?: boolean }) {
  const tr = makeTr(locale, pseudo);
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 py-1 pr-2.5 pl-2 border-destructive/40 bg-destructive/5 text-foreground",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
      {tr.text("calls.textbackFailed")}
    </Badge>
  );
}
