// S-47d Task 15 finding: `business-status-card-boundary.tsx` ("use client") was importing this
// component from the server card's own module, which also holds the async SERVER component and its
// database and Clerk imports (transitively the "server only" package). Turbopack refuses to bundle a
// module carrying that package into a Client Component's graph — it names the server card's module
// under both the Client Component Browser and SSR graphs the moment ANYTHING is imported from it by
// a client module, whether or not the importer actually uses the server-only exports.
// `BusinessStatusCardError` therefore lives in its own module with NO server imports (checked by this
// file's own test: no database import, no Clerk, no "server only" literal), so both the server card
// (which re-exports nothing from here) and the client boundary can import it without either one
// pulling the other's half of the graph along.
import { Card, CardContent } from "@/components/ui/card";
import { RecordCardError } from "@/components/record/record-card";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

/** Spec §5.6.2: "Couldn't load today's status." with a Retry link (a reload) — the rest of the
 *  dashboard renders regardless (this card's own RecordCardBoundary, never the page's). */
export function BusinessStatusCardError({
  locale, pseudo = false, onRetry, id = "business-status",
}: { locale: Locale; pseudo?: boolean; onRetry?: () => void; /** Only the styleguide names its own. */ id?: string }) {
  // Fix round D6: the QA pseudo-locale, as the card it stands in for.
  const tr = makeTr(locale, pseudo);
  return (
    <Card id={id} lang={locale}>
      <CardContent className="pt-6">
        <RecordCardError text={tr.text("business.card.error")} retryLabel={tr.text("business.card.retry")} onRetry={onRetry} />
      </CardContent>
    </Card>
  );
}
