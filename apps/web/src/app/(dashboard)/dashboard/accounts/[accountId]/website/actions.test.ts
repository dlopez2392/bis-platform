import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ upsertSite: vi.fn(), getSiteForAccount: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}) }));
const authMock = vi.hoisted(() => ({ requireAccountAccess: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (...a: unknown[]) => authMock.requireAccountAccess(...a) }));
const vercelMocks = vi.hoisted(() => ({ fromEnv: vi.fn(), countVisits: vi.fn() }));
vi.mock("@/lib/vercel/web-analytics", async (importOriginal) => ({
  ...(await importOriginal<object>()), vercelAnalyticsFromEnv: () => vercelMocks.fromEnv(),
}));

import { VercelApiError } from "@/lib/vercel/web-analytics";
import { m } from "@/lib/messages";
import { saveSiteAction, testSiteConnectionAction } from "./actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  authMock.requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_agency", isAgency: true });
  vercelMocks.fromEnv.mockReset().mockReturnValue({ countVisits: (...a: unknown[]) => vercelMocks.countVisits(...a) });
  vercelMocks.countVisits.mockReset().mockResolvedValue({ visitors: 12, pageviews: 30 });
  dbMocks.upsertSite.mockResolvedValue({ id: "site_1" });
});

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
