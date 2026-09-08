"use server";

import { revalidatePath } from "next/cache";
import { serviceDb, upsertSite, getSiteForAccount, unlinkSite, emit } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { vercelAnalyticsFromEnv, VercelApiError } from "@/lib/vercel/web-analytics";
import { m } from "@/lib/messages";

/** Agency-only, re-checked here (hiding the card is not authorization) — the
 *  voice/automations precedent. Writes through serviceDb(): `sites` has no
 *  client write grant by design (0029). */
async function requireAgency(accountId: string): Promise<string> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) throw new Error("only the agency may link a website");
  return userId;
}

/** Vercel project ids are `prj_` + alphanumerics; anything else is a tampered
 *  hidden field, refused with the same sentence as an empty pick. */
const PROJECT_ID = /^prj_[A-Za-z0-9_]+$/;

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export async function saveSiteAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireAgency(accountId);
  const vercelProjectId = String(formData.get("vercelProjectId") ?? "").trim();
  if (!PROJECT_ID.test(vercelProjectId)) return { ok: false, error: m["website.link.projectRequired"] };
  const domain = normalizeDomain(String(formData.get("domain") ?? ""));
  if (!domain) return { ok: false, error: m["website.link.domainRequired"] };
  const db = serviceDb();
  // Re-pointing an account at a different project would file the new site's
  // days under the old site id and resume from the old stamp — two sites'
  // history under one heading. Refused once any day is on record; the
  // runbook's unlink order is the way through. Before the first sync there
  // is nothing to mix, and a domain correction on the same project is fine.
  const current = await getSiteForAccount(db, accountId);
  if (current && current.vercelProjectId !== vercelProjectId && current.lastSyncedDay !== null) {
    return { ok: false, error: m["website.link.projectChange"] };
  }
  try {
    await upsertSite(db, accountId, { vercelProjectId, domain });
  } catch (e) {
    // One project, one account (0029's unique): a second client picking a
    // project already linked elsewhere is 23505 and gets its own sentence.
    // Everything else is generic — the raw message names tables and ids.
    if ((e as { code?: unknown }).code === "23505") return { ok: false, error: m["website.link.alreadyLinked"] };
    console.error(`website: link save failed for account ${accountId}, project ${vercelProjectId}: ${String(e)}`);
    return { ok: false, error: m["website.link.saveFailed"] };
  }
  await emit(db, accountId, "site.linked", userId, { vercelProjectId, domain });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/website`);
  return { ok: true };
}

/** Removes the link and every stored day (the runbook's manual order, in
 *  code). The event is written AFTER the delete so the record never claims a
 *  removal that did not happen; the raw error stays in the server log. */
export async function unlinkSiteAction(
  accountId: string,
): Promise<{ ok: true; daysDeleted: number } | { ok: false; error: string }> {
  const userId = await requireAgency(accountId);
  const db = serviceDb();
  const site = await getSiteForAccount(db, accountId);
  if (!site) return { ok: false, error: m["website.link.notLinked"] };
  let daysDeleted: number;
  try {
    ({ daysDeleted } = await unlinkSite(db, accountId));
  } catch (e) {
    console.error(`website: unlink failed for account ${accountId}, site ${site.id}: ${String(e)}`);
    return { ok: false, error: m["website.link.unlinkFailed"] };
  }
  await emit(db, accountId, "site.unlinked", userId, { vercelProjectId: site.vercelProjectId, domain: site.domain, daysDeleted });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/website`);
  return { ok: true, daysDeleted };
}

/** One count query for the last 7 days. The raw error never reaches the
 *  operator: a Vercel message can name projects and teams that are not
 *  this client's business, and a token error can carry the token's name. */
export async function testSiteConnectionAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true; visitors: number; pageviews: number } | { ok: false; error: string }> {
  await requireAgency(accountId);
  const vercelProjectId = String(formData.get("vercelProjectId") ?? "").trim();
  if (!vercelProjectId) return { ok: false, error: m["website.link.projectRequired"] };
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  try {
    const api = vercelAnalyticsFromEnv();
    const counts = await api.countVisits(vercelProjectId, since.toISOString(), until.toISOString());
    const db = serviceDb();
    const site = await getSiteForAccount(db, accountId);
    if (site && site.vercelProjectId === vercelProjectId) {
      await upsertSite(db, accountId, { vercelProjectId, domain: site.domain, analyticsEnabledAt: until.toISOString() });
    }
    return { ok: true, ...counts };
  } catch (e) {
    if (e instanceof VercelApiError && e.code === "web_analytics_not_enabled") {
      return { ok: false, error: m["website.link.testNotEnabled"] };
    }
    console.error(`website: test connection failed for account ${accountId}, project ${vercelProjectId}: ${String(e)}`);
    return { ok: false, error: m["website.link.testFailed"] };
  }
}
