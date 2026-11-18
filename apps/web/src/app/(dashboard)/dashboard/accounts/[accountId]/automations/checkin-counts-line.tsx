import { serviceDb, checkinCounts } from "@bis/db";
import { CheckinCountsView, type CheckinCountsState } from "./checkin-counts";

/** The window the card reports: the last 30 days (plan D8). */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The counts line's read (plan D8), a server component the page streams inside Suspense (the skeleton is the
 * fallback). Agency-only page, so `serviceDb()` like every read beside it. A failed read is the error state with the
 * account id in the log, never a zero and never a 500 for the whole page.
 */
export async function CheckinCountsLine({ accountId }: { accountId: string }) {
  return <CheckinCountsView state={await readCheckinCounts(accountId)} />;
}

async function readCheckinCounts(accountId: string): Promise<CheckinCountsState> {
  try {
    return { kind: "loaded", counts: await checkinCounts(serviceDb(), accountId, new Date(Date.now() - WINDOW_MS).toISOString()) };
  } catch (e) {
    console.error(`automations: check-in counts read failed for ${accountId}: ${String(e)}`);
    return { kind: "error" };
  }
}
