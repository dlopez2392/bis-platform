import { describe, it, expect, vi, beforeEach } from "vitest";

/** clients: every serviceDb() made. None may be made before requireAgencyOnlyAccountAccess let the caller through. */
const guard = vi.hoisted(() => ({ agency: true, clients: 0, calls: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async (accountId: string) => {
    guard.calls.push(`guard ${accountId}`);
    if (!guard.agency) throw new Error("NEXT_REDIRECT");
    return { userId: "u_agency" };
  },
}));
const dbm = vi.hoisted(() => ({ getAiSettings: vi.fn(), setAccountAiSettings: vi.fn(), setGlobalAiEnabled: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAiSettings: dbm.getAiSettings, setAccountAiSettings: dbm.setAccountAiSettings, setGlobalAiEnabled: dbm.setGlobalAiEnabled,
  serviceDb: () => { guard.clients += 1; guard.calls.push("serviceDb"); return { tag: "service" }; },
}));

const { saveAccountAiAction, undoAccountAiAction, setGlobalAiAction } = await import("./ai-actions");
const SVC = { tag: "service" };
const STORED = { accountEnabled: true, monthlyBudgetCents: 1000, monthKey: "2026-10", monthSpendMicroUsd: 0, globalEnabled: true };

beforeEach(() => {
  guard.agency = true; guard.clients = 0; guard.calls = [];
  dbm.getAiSettings.mockReset().mockResolvedValue(STORED);
  dbm.setAccountAiSettings.mockReset().mockResolvedValue(undefined);
  dbm.setGlobalAiEnabled.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the AI card's actions are agency-only, guard first (spec 3.3, 3.6)", () => {
  const all: [string, () => Promise<unknown>][] = [
    ["save", () => saveAccountAiAction("a1", { enabled: false, budget: "25" })],
    ["undo", () => undoAccountAiAction("a1", { enabled: true, monthlyBudgetCents: 1000 })],
    ["global", () => setGlobalAiAction("a1", { enabled: false, confirm: "OFF" })],
  ];
  it.each(all)("%s: a non-agency caller is redirected before any client exists or anything is written (mutation: move the guard below serviceDb() -> FAILS)", async (_name, run) => {
    guard.agency = false;
    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.clients).toBe(0);
    expect([dbm.setAccountAiSettings.mock.calls.length, dbm.setGlobalAiEnabled.mock.calls.length]).toEqual([0, 0]);
  });
  it.each(all)("%s: the guard names THIS account and runs first (mutation: guard a constant account -> FAILS)", async (_name, run) => {
    await run();
    expect(guard.calls[0]).toBe("guard a1");
  });
});

describe("saveAccountAiAction", () => {
  it("writes the switch and the budget in cents on the service client, as the agency user, and answers the prior values (mutation: write budget dollars as cents -> FAILS)", async () => {
    expect(await saveAccountAiAction("a1", { enabled: false, budget: "$25" })).toEqual({ ok: true, prior: { enabled: true, monthlyBudgetCents: 1000 } });
    expect(dbm.setAccountAiSettings).toHaveBeenCalledWith(SVC, "a1", { enabled: false, monthlyBudgetCents: 2500, actorId: "u_agency" });
  });
  it.each(["", "abc", "1001", "10.50"])("refuses the budget %j with the budget sentence and writes nothing (mutation: skip parseBudgetDollars -> FAILS)", async (budget) => {
    expect(await saveAccountAiAction("a1", { enabled: true, budget })).toEqual({ ok: false, error: "aiSettings.error.budget" });
    expect(dbm.setAccountAiSettings).not.toHaveBeenCalled();
  });
  it("a failed write answers the failed sentence and logs the account, never the input (mutation: rethrow -> FAILS)", async () => {
    dbm.setAccountAiSettings.mockRejectedValue(new Error("setAccountAiSettings failed: boom"));
    expect(await saveAccountAiAction("a1", { enabled: true, budget: "777" })).toEqual({ ok: false, error: "aiSettings.error.failed" });
    const line = String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]);
    expect(line).toBe("ai settings: save failed for account a1: Error: setAccountAiSettings failed: boom");
  });
});

describe("undoAccountAiAction", () => {
  it("writes back exactly the prior values (mutation: write the defaults -> FAILS)", async () => {
    await undoAccountAiAction("a1", { enabled: false, monthlyBudgetCents: 4200 });
    expect(dbm.setAccountAiSettings).toHaveBeenCalledWith(SVC, "a1", { enabled: false, monthlyBudgetCents: 4200, actorId: "u_agency" });
  });
  it.each([{ enabled: "yes", monthlyBudgetCents: 1000 }, { enabled: true, monthlyBudgetCents: 100001 }, { enabled: true, monthlyBudgetCents: 10.5 }])(
    "refuses a prior that is not one this card could have read: %j (mutation: write any prior -> FAILS)", async (prior) => {
      expect(await undoAccountAiAction("a1", prior as never)).toEqual({ ok: false, error: "aiSettings.error.failed" });
      expect(dbm.setAccountAiSettings).not.toHaveBeenCalled();
    });
});

describe("setGlobalAiAction (choice I12, rule 6)", () => {
  it("turning AI off everywhere needs the typed word; without it nothing is written (mutation: skip isConfirmWord -> FAILS)", async () => {
    for (const confirm of [undefined, "", "of", "yes"]) {
      expect(await setGlobalAiAction("a1", { enabled: false, confirm })).toEqual({ ok: false, error: "aiSettings.global.wrongWord" });
    }
    expect(dbm.setGlobalAiEnabled).not.toHaveBeenCalled();
  });
  it("with the word, in either language, it turns off and answers the prior state", async () => {
    expect(await setGlobalAiAction("a1", { enabled: false, confirm: "apagar" })).toEqual({ ok: true, prior: true });
    expect(dbm.setGlobalAiEnabled).toHaveBeenCalledWith(SVC, { enabled: false, actorId: "u_agency" });
  });
  it("turning it back on needs no word (rule 6: reversible, immediate)", async () => {
    dbm.getAiSettings.mockResolvedValue({ ...STORED, globalEnabled: false });
    expect(await setGlobalAiAction("a1", { enabled: true })).toEqual({ ok: true, prior: false });
    expect(dbm.setGlobalAiEnabled).toHaveBeenCalledWith(SVC, { enabled: true, actorId: "u_agency" });
  });
});
