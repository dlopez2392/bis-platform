// S-47a §5.3: the async server component that reads the results and hands the pure view to
// disclosure-results-view.tsx. Re-exports its skeleton so page.tsx needs only this one import for the
// Suspense boundary (ai-section.tsx's own `export { AiCardSkeleton } from "./ai-card"` precedent).
import { getDisclosureResults, type DisclosureSetting, type SupabaseClient } from "@bis/db";
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
 *
 * `db` is the client page.tsx already holds behind requireAgencyOnlyAccountAccess: this card never gets
 * a service client of its own (in-account-service-reads.test.ts lists every file that does, with its
 * reason). `setting` is the STORED Off / Trial / On, for the empty state's copy.
 */
export async function DisclosureResultsCard({
  db, accountId, setting, retryHref, tr,
}: { db: SupabaseClient; accountId: string; setting: DisclosureSetting; retryHref: string; tr: Tr }) {
  let view: ResultsView | { state: "error" };
  try {
    view = disclosureResultsView(await getDisclosureResults(db, accountId));
  } catch (e) {
    console.error(`voice: disclosure results read failed for account ${accountId}: ${loggableError(e)}`);
    view = { state: "error" };
  }
  return <DisclosureResultsView view={view} tr={tr} setting={setting} retryHref={retryHref} />;
}
