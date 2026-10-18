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
const STORED = { accountEnabled: true, monthlyBudgetCents: 1000, monthKey: "2026-10", monthSpendMicroUsd: 0, globalEnabled: true, dayKey: null, recordSummariesToday: 0 };
const WROTE = { enabled: false, monthlyBudgetCents: 2500 };

/**
 * Fix round 2: the mocked store is STATEFUL. A write changes what the next read answers, so an action that read
 * AFTER its write would answer the NEW values as "prior" (and its Undo would put back what it just wrote).
 * `order` records reads and writes as they happen.
 */
let state = { ...STORED };
let order: string[] = [];

beforeEach(() => {
  guard.agency = true; guard.clients = 0; guard.calls = [];
  state = { ...STORED }; order = [];
  dbm.getAiSettings.mockReset().mockImplementation(async () => { order.push("read"); return { ...state }; });
  dbm.setAccountAiSettings.mockReset().mockImplementation(async (_db: unknown, _a: string, s: { enabled: boolean; monthlyBudgetCents: number }) => {
    order.push("write"); state = { ...state, accountEnabled: s.enabled, monthlyBudgetCents: s.monthlyBudgetCents }; return "updated";
  });
  dbm.setGlobalAiEnabled.mockReset().mockImplementation(async (_db: unknown, s: { enabled: boolean }) => {
    order.push("write"); state = { ...state, globalEnabled: s.enabled }; return "updated";
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the AI card's actions are agency-only, guard first (spec 3.3, 3.6)", () => {
  const all: [string, () => Promise<unknown>][] = [
    ["save", () => saveAccountAiAction("a1", { enabled: false, budget: "25" })],
    ["undo", () => undoAccountAiAction("a1", { enabled: true, monthlyBudgetCents: 1000 }, WROTE)],
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
  it("writes the switch and the budget in cents on the service client, as the agency user, and answers the prior values and what it wrote (mutation: write budget dollars as cents -> FAILS)", async () => {
    expect(await saveAccountAiAction("a1", { enabled: false, budget: "$25" })).toEqual({ ok: true, prior: { enabled: true, monthlyBudgetCents: 1000 }, wrote: WROTE });
    expect(dbm.setAccountAiSettings).toHaveBeenCalledWith(SVC, "a1", { enabled: false, monthlyBudgetCents: 2500, actorId: "u_agency" });
  });
  it("reads the prior values BEFORE it writes, so the prior is what was stored, not what it wrote (fix round 2; mutation: read after the write -> FAILS)", async () => {
    const r = await saveAccountAiAction("a1", { enabled: false, budget: "25" });
    expect(order).toEqual(["read", "write"]);
    expect(r).toEqual({ ok: true, prior: { enabled: STORED.accountEnabled, monthlyBudgetCents: STORED.monthlyBudgetCents }, wrote: WROTE });
  });
  it.each(["", "abc", "1001", "10.50"])("refuses the budget %j with the budget sentence and writes nothing (mutation: skip parseBudgetDollars -> FAILS)", async (budget) => {
    expect(await saveAccountAiAction("a1", { enabled: true, budget })).toEqual({ ok: false, error: "aiSettings.error.budget" });
    expect(dbm.setAccountAiSettings).not.toHaveBeenCalled();
  });
  it.each(["false", 0, null])("refuses a switch that is not a boolean (%j) and writes nothing (fix round 1; mutation: drop the typeof enabled check -> FAILS)", async (enabled) => {
    expect(await saveAccountAiAction("a1", { enabled: enabled as never, budget: "25" })).toEqual({ ok: false, error: "aiSettings.error.failed" });
    expect(dbm.setAccountAiSettings).not.toHaveBeenCalled();
  });
  it("a failed write answers the failed sentence and logs the account, never the input (mutation: rethrow -> FAILS)", async () => {
    dbm.setAccountAiSettings.mockRejectedValue(new Error("setAccountAiSettings failed: boom"));
    expect(await saveAccountAiAction("a1", { enabled: true, budget: "777" })).toEqual({ ok: false, error: "aiSettings.error.failed" });
    const line = String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]);
    expect(line).toBe("ai settings: save failed for account a1: Error: setAccountAiSettings failed: boom");
  });
});

describe("undoAccountAiAction (a compare-and-set on what its save wrote, fix round 4)", () => {
  it("writes back exactly the prior values, only while the row still holds what the save wrote (mutations: write the defaults; drop the expected argument -> FAILS)", async () => {
    await undoAccountAiAction("a1", { enabled: false, monthlyBudgetCents: 4200 }, WROTE);
    expect(dbm.setAccountAiSettings).toHaveBeenCalledWith(SVC, "a1", { enabled: false, monthlyBudgetCents: 4200, actorId: "u_agency" }, WROTE);
  });
  it("someone saved after: the store answers 'changed' and the Undo says nothing was undone (mutation: ignore the outcome -> FAILS)", async () => {
    dbm.setAccountAiSettings.mockResolvedValueOnce("changed");
    expect(await undoAccountAiAction("a1", { enabled: true, monthlyBudgetCents: 1000 }, WROTE)).toEqual({ ok: false, error: "documents.undoChanged" });
  });
  it.each([
    [{ enabled: "yes", monthlyBudgetCents: 1000 }, WROTE], [{ enabled: true, monthlyBudgetCents: 100001 }, WROTE],
    [{ enabled: true, monthlyBudgetCents: 10.5 }, WROTE], [{ enabled: true, monthlyBudgetCents: -100 }, WROTE],
    [{ enabled: true, monthlyBudgetCents: 1000 }, { enabled: "no", monthlyBudgetCents: 2500 }], [{ enabled: true, monthlyBudgetCents: 1000 }, { enabled: false, monthlyBudgetCents: -1 }],
    [{ enabled: true, monthlyBudgetCents: 1000 }, undefined],
  ])("refuses a prior or a wrote that is not one this card could have read: %j %j (mutation: write any prior -> FAILS)", async (prior, wrote) => {
    expect(await undoAccountAiAction("a1", prior as never, wrote as never)).toEqual({ ok: false, error: "aiSettings.error.failed" });
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
  it.each(["false", 0, null])("a switch that is not a boolean (%j) never skips the typed word and writes nothing (fix round 1; mutation: drop the typeof enabled check -> FAILS)", async (enabled) => {
    expect(await setGlobalAiAction("a1", { enabled: enabled as never })).toEqual({ ok: false, error: "aiSettings.error.failed" });
    expect(dbm.setGlobalAiEnabled).not.toHaveBeenCalled();
  });
  it("with the word, in either language, it turns off and answers the prior state", async () => {
    expect(await setGlobalAiAction("a1", { enabled: false, confirm: "apagar" })).toEqual({ ok: true, prior: true });
    expect(dbm.setGlobalAiEnabled).toHaveBeenCalledWith(SVC, { enabled: false, actorId: "u_agency" });
  });
  it("reads the prior state BEFORE it writes (fix round 2; mutation: read after the write -> FAILS)", async () => {
    const r = await setGlobalAiAction("a1", { enabled: false, confirm: "OFF" });
    expect(order).toEqual(["read", "write"]);
    expect(r).toEqual({ ok: true, prior: STORED.globalEnabled });
  });
  it("turning it back on needs no word (rule 6: reversible, immediate)", async () => {
    state = { ...state, globalEnabled: false };
    expect(await setGlobalAiAction("a1", { enabled: true })).toEqual({ ok: true, prior: false });
    expect(dbm.setGlobalAiEnabled).toHaveBeenCalledWith(SVC, { enabled: true, actorId: "u_agency" });
  });
  it("its Undo passes what the action wrote as `expected`, and 'changed' says nothing was undone (fix round 4; mutations: drop expected; ignore the outcome -> FAILS)", async () => {
    state = { ...state, globalEnabled: false };
    expect(await setGlobalAiAction("a1", { enabled: true, expected: false })).toEqual({ ok: true, prior: false });
    expect(dbm.setGlobalAiEnabled).toHaveBeenCalledWith(SVC, { enabled: true, actorId: "u_agency" }, false);
    dbm.setGlobalAiEnabled.mockResolvedValueOnce("changed");
    expect(await setGlobalAiAction("a1", { enabled: false, confirm: "OFF", expected: true })).toEqual({ ok: false, error: "documents.undoChanged" });
  });
  it("an Undo that turns AI off everywhere still needs the typed word: `expected` never stands in for it (round 2, plan M12; mutation: skip the word when expected is set -> FAILS)", async () => {
    expect(await setGlobalAiAction("a1", { enabled: false, expected: true })).toEqual({ ok: false, error: "aiSettings.global.wrongWord" });
    expect(dbm.setGlobalAiEnabled).not.toHaveBeenCalled();
  });
  it("an `expected` that is not a boolean writes nothing (fix round 4)", async () => {
    expect(await setGlobalAiAction("a1", { enabled: true, expected: "false" as never })).toEqual({ ok: false, error: "aiSettings.error.failed" });
    expect(dbm.setGlobalAiEnabled).not.toHaveBeenCalled();
  });
});
