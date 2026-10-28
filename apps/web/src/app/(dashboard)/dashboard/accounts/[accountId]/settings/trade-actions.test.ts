import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ setAccountTrade: vi.fn(), getVoiceProfile: vi.fn(), listPhoneNumbersForAccount: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}) }));
// The real requireAgencyOnlyAccountAccess REDIRECTS a non-agency caller (Next's redirect() throws); the mock
// throws the same way for a non-agency fixture, so "refused before any read or write" is provable (plan review I5).
const guard = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => {
    if (!guard.isAgency) throw new Error("NEXT_REDIRECT");
    return { userId: "user_agency", isAgency: true };
  },
}));

import { m } from "@/lib/messages";
import { setTradeAction } from "./trade-actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  Object.values(dbMocks).forEach((x) => x.mockReset());
  dbMocks.setAccountTrade.mockResolvedValue(undefined);
  dbMocks.getVoiceProfile.mockResolvedValue(null);
  dbMocks.listPhoneNumbersForAccount.mockResolvedValue([]);
  guard.isAgency = true;
});

describe("setTradeAction (spec 5.2)", () => {
  it("a non-agency caller is refused before any read or write (mutation: move the guard below the writes -> FAILS)", async () => {
    guard.isAgency = false;
    await expect(setTradeAction("a1", fd({ trade: "restaurant" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
    expect(dbMocks.getVoiceProfile).not.toHaveBeenCalled();
    expect(dbMocks.listPhoneNumbersForAccount).not.toHaveBeenCalled();
  });
  it("saves an allowed trade without reading Sofía's state", async () => {
    expect(await setTradeAction("a1", fd({ trade: "roofing" }))).toEqual({ ok: true });
    expect(dbMocks.setAccountTrade).toHaveBeenCalledWith({}, "a1", { trade: "roofing", tradeOther: null }, "user_agency");
    expect(dbMocks.getVoiceProfile).not.toHaveBeenCalled();
  });
  // Exact sentences, not just `ok: false` (deviation from the plan's toMatchObject): the title promises
  // Add company's words, and only an exact match can fail when the refusal says something else.
  it.each([
    ["law", "Law firms open once our Texas cloud-storage sheet for lawyers (Opinions 680 and 705) is ready."],
    ["home_health", "BIS doesn't serve adult day care or home health, so we can't take this business on."],
    ["", m["vetting.error.missing"]],
  ])("refuses %j with the same words as Add company, writing nothing (mutation: a generic refusal -> FAILS)", async (trade, error) => {
    const r = await setTradeAction("a1", fd({ trade }));
    expect(r).toEqual({ ok: false, error });
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
  });
  it("refuses a CRM-only trade while Sofía is answering (mutation: drop the answering check -> FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: false, concierge_enabled: false });
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ status: "testing" }]);
    expect(await setTradeAction("a1", fd({ trade: "restaurant" }))).toEqual({ ok: false, error: m["vetting.turnOffFirst"] });
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
  });
  it("refuses a CRM-only trade while the web chat is on, in Spanish when asked", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: false, concierge_enabled: true });
    expect(await setTradeAction("a1", fd({ trade: "child_care", locale: "es" }))).toEqual({ ok: false, error: m["vetting.turnOffFirst.es"] });
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
  });
  it("saves Other with its description trimmed to one line (T4+T6 review m1; mutation: write the raw description -> FAILS)", async () => {
    expect(await setTradeAction("a1", fd({ trade: "other", tradeOther: "  Sign   painting " }))).toEqual({ ok: true });
    expect(dbMocks.setAccountTrade).toHaveBeenCalledWith({}, "a1", { trade: "other", tradeOther: "Sign painting" }, "user_agency");
  });
  it("refuses Other with a blank description, writing nothing (mutation: let a blank Other through -> FAILS)", async () => {
    expect(await setTradeAction("a1", fd({ trade: "other", tradeOther: "   " })))
      .toEqual({ ok: false, error: m["vetting.error.otherDescription"] });
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
  });
  it("refuses a CRM-only trade while a live number answers with an enabled profile", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: true, concierge_enabled: false });
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ status: "live" }]);
    expect(await setTradeAction("a1", fd({ trade: "restaurant" }))).toEqual({ ok: false, error: m["vetting.turnOffFirst"] });
  });
  it("saves a CRM-only trade when Sofía is off (a live number with a disabled profile does not answer)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: false, concierge_enabled: false });
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ status: "live" }]);
    expect(await setTradeAction("a1", fd({ trade: "restaurant" }))).toEqual({ ok: true });
  });
  it("fails closed when Sofía's state cannot be read", async () => {
    dbMocks.listPhoneNumbersForAccount.mockRejectedValue(new Error("down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setTradeAction("a1", fd({ trade: "restaurant" }))).toEqual({ ok: false, error: m["vetting.saveFailed"] });
    errSpy.mockRestore();
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
  });
  it("reports a failed write in words", async () => {
    dbMocks.setAccountTrade.mockRejectedValue(new Error("setAccountTrade failed: boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setTradeAction("a1", fd({ trade: "hvac" }))).toEqual({ ok: false, error: m["vetting.saveFailed"] });
    errSpy.mockRestore();
  });
});
