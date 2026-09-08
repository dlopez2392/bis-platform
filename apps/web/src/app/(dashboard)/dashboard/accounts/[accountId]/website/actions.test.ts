import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ upsertSite: vi.fn(), getSiteForAccount: vi.fn(), unlinkSite: vi.fn(), emit: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}) }));
const authMock = vi.hoisted(() => ({ requireAccountAccess: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (...a: unknown[]) => authMock.requireAccountAccess(...a) }));
const vercelMocks = vi.hoisted(() => ({ fromEnv: vi.fn(), countVisits: vi.fn() }));
vi.mock("@/lib/vercel/web-analytics", async (importOriginal) => ({
  ...(await importOriginal<object>()), vercelAnalyticsFromEnv: () => vercelMocks.fromEnv(),
}));

import { VercelApiError } from "@/lib/vercel/web-analytics";
import { m } from "@/lib/messages";
import { saveSiteAction, testSiteConnectionAction, unlinkSiteAction } from "./actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  authMock.requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_agency", isAgency: true });
  vercelMocks.fromEnv.mockReset().mockReturnValue({ countVisits: (...a: unknown[]) => vercelMocks.countVisits(...a) });
  vercelMocks.countVisits.mockReset().mockResolvedValue({ visitors: 12, pageviews: 30 });
  dbMocks.upsertSite.mockResolvedValue({ id: "site_1" });
  dbMocks.getSiteForAccount.mockResolvedValue(null);
});

const linked = (over: Partial<{ vercelProjectId: string; domain: string; lastSyncedDay: string | null }> = {}) =>
  ({ id: "site_1", accountId: "acct_1", vercelProjectId: "prj_old", domain: "old.example", analyticsEnabledAt: null, lastSyncedDay: "2026-09-06", ...over });

describe("saveSiteAction", () => {
  // Mutation: drop the isAgency check in requireAgency — the client case saves.
  it("refuses a non-agency caller before touching the database", async () => {
    authMock.requireAccountAccess.mockResolvedValue({ userId: "user_client", isAgency: false });
    await expect(saveSiteAction("acct_1", fd({ vercelProjectId: "prj_1", domain: "rio.example" }))).rejects.toThrow(/agency/);
    expect(dbMocks.upsertSite).not.toHaveBeenCalled();
  });
  it("refuses a missing project or domain with the named message, without writing", async () => {
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "", domain: "rio.example" }))).toEqual({ ok: false, error: m["website.link.projectRequired"] });
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_1", domain: "  " }))).toEqual({ ok: false, error: m["website.link.domainRequired"] });
    expect(dbMocks.upsertSite).not.toHaveBeenCalled();
  });
  it("saves a trimmed, lower-cased domain without scheme or path", async () => {
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_1", domain: " https://Rio.Example/path " }))).toEqual({ ok: true });
    expect(dbMocks.upsertSite).toHaveBeenCalledWith(expect.anything(), "acct_1", { vercelProjectId: "prj_1", domain: "rio.example" });
    // Mutation: drop the emit — who linked which site stops being recorded.
    expect(dbMocks.emit).toHaveBeenCalledWith(expect.anything(), "acct_1", "site.linked", "user_agency", { vercelProjectId: "prj_1", domain: "rio.example" });
  });
  it("refuses a project id that is not prj_-shaped, without writing", async () => {
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "not a project", domain: "rio.example" }))).toEqual({ ok: false, error: m["website.link.projectRequired"] });
    expect(dbMocks.upsertSite).not.toHaveBeenCalled();
  });
  // Mutation: map 23505 to saveFailed too — the one refusal an operator can
  // act on ("that project is another client's") loses its sentence.
  it("a project already linked to another client (23505) gets its own sentence; any other failure is generic and never leaks the message", async () => {
    dbMocks.upsertSite.mockRejectedValueOnce(Object.assign(new Error('upsertSite failed: duplicate key value violates unique constraint "sites_vercel_project_id_key"'), { code: "23505" }));
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_1", domain: "rio.example" }))).toEqual({ ok: false, error: m["website.link.alreadyLinked"] });
    dbMocks.upsertSite.mockRejectedValueOnce(new Error("upsertSite failed: table-naming message"));
    const r = await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_1", domain: "rio.example" }));
    expect(r).toEqual({ ok: false, error: m["website.link.saveFailed"] });
  });
  // Mutation: drop the lastSyncedDay condition (or the whole guard) — the
  // re-point with history on record writes.
  it("refuses re-pointing an account at a different project once a day of traffic is on record; allows it before the first sync and for a domain fix on the same project", async () => {
    dbMocks.getSiteForAccount.mockResolvedValueOnce(linked());
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_new", domain: "new.example" }))).toEqual({ ok: false, error: m["website.link.projectChange"] });
    expect(dbMocks.upsertSite).not.toHaveBeenCalled();
    dbMocks.getSiteForAccount.mockResolvedValueOnce(linked({ lastSyncedDay: null }));
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_new", domain: "new.example" }))).toEqual({ ok: true });
    dbMocks.getSiteForAccount.mockResolvedValueOnce(linked());
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_old", domain: "fixed.example" }))).toEqual({ ok: true });
    expect(dbMocks.upsertSite).toHaveBeenCalledTimes(2);
  });
});

describe("testSiteConnectionAction", () => {
  it("returns the 7-day count on success and stamps analytics_enabled_at when the site is already linked", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue({ id: "site_1", vercelProjectId: "prj_1", domain: "rio.example" });
    expect(await testSiteConnectionAction("acct_1", fd({ vercelProjectId: "prj_1" }))).toEqual({ ok: true, visitors: 12, pageviews: 30 });
    expect(dbMocks.upsertSite).toHaveBeenCalledWith(expect.anything(), "acct_1", expect.objectContaining({ analyticsEnabledAt: expect.any(String) }));
  });
  // Mutation: map every VercelApiError to testFailed — the not-enabled case
  // loses its specific, actionable message.
  it("names 'analytics not enabled' specifically, and everything else generically, never leaking the raw error", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue(null);
    vercelMocks.countVisits.mockRejectedValueOnce(new VercelApiError(400, "web_analytics_not_enabled", "Web Analytics is not enabled for this project"));
    expect(await testSiteConnectionAction("acct_1", fd({ vercelProjectId: "prj_1" }))).toEqual({ ok: false, error: m["website.link.testNotEnabled"] });
    vercelMocks.countVisits.mockRejectedValueOnce(new Error("secret-bearing message"));
    const r = await testSiteConnectionAction("acct_1", fd({ vercelProjectId: "prj_1" }));
    expect(r).toEqual({ ok: false, error: m["website.link.testFailed"] });
  });
  it("a missing token is the generic failure too, and the client is constructed only inside the action", async () => {
    vercelMocks.fromEnv.mockImplementation(() => { throw new Error("VERCEL_API_TOKEN/VERCEL_TEAM_ID unset"); });
    expect(await testSiteConnectionAction("acct_1", fd({ vercelProjectId: "prj_1" }))).toEqual({ ok: false, error: m["website.link.testFailed"] });
  });
});

describe("unlinkSiteAction", () => {
  // Mutation: drop the isAgency throw in requireAgency — the client case deletes.
  it("refuses a non-agency caller before touching the database", async () => {
    authMock.requireAccountAccess.mockResolvedValue({ userId: "user_client", isAgency: false });
    await expect(unlinkSiteAction("acct_1")).rejects.toThrow(/agency/);
    expect(dbMocks.unlinkSite).not.toHaveBeenCalled();
  });
  it("says so when nothing is linked, without deleting", async () => {
    expect(await unlinkSiteAction("acct_1")).toEqual({ ok: false, error: m["website.link.notLinked"] });
    expect(dbMocks.unlinkSite).not.toHaveBeenCalled();
  });
  // Mutation: drop the emit, or emit before the delete — the record of who
  // removed which site (and how much history went with it) disappears or
  // claims a deletion that may not have happened.
  it("deletes the site and its history, then records site.unlinked with the domain, project and days, and reports the days", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue(linked());
    dbMocks.unlinkSite.mockResolvedValue({ daysDeleted: 30 });
    expect(await unlinkSiteAction("acct_1")).toEqual({ ok: true, daysDeleted: 30 });
    expect(dbMocks.unlinkSite).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.emit).toHaveBeenCalledWith(expect.anything(), "acct_1", "site.unlinked", "user_agency",
      { vercelProjectId: "prj_old", domain: "old.example", daysDeleted: 30 });
    expect(dbMocks.unlinkSite.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.emit.mock.invocationCallOrder[0]!);
  });
  it("a failure is generic and never leaks the message", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue(linked());
    dbMocks.unlinkSite.mockRejectedValueOnce(new Error("table-naming message"));
    expect(await unlinkSiteAction("acct_1")).toEqual({ ok: false, error: m["website.link.unlinkFailed"] });
    expect(dbMocks.emit).not.toHaveBeenCalled();
  });
});
