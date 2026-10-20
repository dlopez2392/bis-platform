// S-47a §5.3: the async server component that reads the results and hands the pure view to
// disclosure-results-view.tsx. Re-exports its skeleton so page.tsx needs only this one import for the
// Suspense boundary (ai-section.tsx's own `export { AiCardSkeleton } from "./ai-card"` precedent).
import { serviceDb, getDisclosureResults } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { disclosureResultsView, type DisclosureResultsView as ResultsView } from "@/lib/voice/disclosure-results";
import type { Tr } from "@/lib/record/copy";
import { DisclosureResultsView } from "./disclosure-results-view";

export { DisclosureResultsSkeleton } from "./disclosure-results-view";

/**
 * Never rethrows (rule 5 extended to the card, not just the screen): a failed read costs this one card,
 * never the Voice page. Logs the account id and the error's class/code/redacted message only
 * (`loggableError`) — never a count or a cell value, which the catch never sees in the first place.
 *
 * The JSX is built OUTSIDE the try/catch (react-hooks/error-boundaries: constructing an element inside a
 * try tells nothing about whether its OWN render throws) — the data read above is what can actually fail.
 */
export async function DisclosureResultsCard({ accountId, tr }: { accountId: string; tr: Tr }) {
  let view: ResultsView | { state: "error" };
  try {
    view = disclosureResultsView(await getDisclosureResults(serviceDb(), accountId));
  } catch (e) {
    console.error(`voice: disclosure results read failed for account ${accountId}: ${loggableError(e)}`);
    view = { state: "error" };
  }
  return <DisclosureResultsView view={view} tr={tr} accountId={accountId} />;
}
