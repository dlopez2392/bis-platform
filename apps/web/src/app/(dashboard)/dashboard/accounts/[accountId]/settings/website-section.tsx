import { vercelAnalyticsFromEnv } from "@/lib/vercel/web-analytics";
import { LinkSiteCard, type VercelProjectOption } from "../website/link-site-card";
import { saveSiteAction, testSiteConnectionAction, unlinkSiteAction } from "../website/actions";

/**
 * The "link a website" card, with the Vercel project list it picks from.
 * Streamed in its own <Suspense> on the Settings page for the same reason as
 * ClientAccessSection: the list is a live call to Vercel's API, and nothing
 * else on the page should wait for a third party. The linked site and its
 * stored-days count are database reads, so the page passes them in.
 */
export async function WebsiteSection({
  accountId,
  linked,
  daysStored,
}: {
  accountId: string;
  linked: { vercelProjectId: string; domain: string } | null;
  daysStored: number;
}) {
  // Listing Vercel projects needs the platform token (runbook step 1).
  // Without it the card still renders — an already-linked site keeps
  // showing its domain; a new one cannot be picked — and says why. Same
  // fail-soft shape as the member list: one missing integration must never
  // take the whole settings page offline.
  let projects: VercelProjectOption[] = [];
  let projectsUnavailable = false;
  try {
    projects = await vercelAnalyticsFromEnv().listProjects();
  } catch (e) {
    console.error(`settings: vercel projects unavailable for account ${accountId}: ${String(e)}`);
    projectsUnavailable = true;
  }

  return (
    <LinkSiteCard
      // Same reason as BrandingPanel's key: the card holds the picked project
      // and typed domain in state, which must not carry from one account's
      // settings page into another's on a client-side navigation.
      key={accountId}
      projects={projects}
      projectsUnavailable={projectsUnavailable}
      linked={linked}
      daysStored={daysStored}
      saveAction={saveSiteAction.bind(null, accountId)}
      testAction={testSiteConnectionAction.bind(null, accountId)}
      unlinkAction={unlinkSiteAction.bind(null, accountId)}
    />
  );
}
