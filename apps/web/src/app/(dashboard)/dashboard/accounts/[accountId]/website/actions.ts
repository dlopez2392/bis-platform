"use server";

import { revalidatePath } from "next/cache";
import { serviceDb, upsertSite, getSiteForAccount } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { vercelAnalyticsFromEnv, VercelApiError } from "@/lib/vercel/web-analytics";
import { m } from "@/lib/messages";

/** Agency-only, re-checked here (hiding the card is not authorization) — the
 *  voice/automations precedent. Writes through serviceDb(): `sites` has no
 *  client write grant by design (0029). */
async function requireAgency(accountId: string): Promise<void> {
  const { isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) throw new Error("only the agency may link a website");
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export async function saveSiteAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAgency(accountId);
  const vercelProjectId = String(formData.get("vercelProjectId") ?? "").trim();
  if (!vercelProjectId) return { ok: false, error: m["website.link.projectRequired"] };
  const domain = normalizeDomain(String(formData.get("domain") ?? ""));
  if (!domain) return { ok: false, error: m["website.link.domainRequired"] };
  await upsertSite(serviceDb(), accountId, { vercelProjectId, domain });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/website`);
  return { ok: true };
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
