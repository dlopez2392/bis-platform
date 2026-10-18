import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidElement, type ReactElement } from "react";

const fx = vi.hoisted(() => ({
  agency: true, reads: [] as string[], fail: false, prefsLanguage: null as "en" | "es" | null,
  settings: { accountEnabled: true, monthlyBudgetCents: 1000, monthKey: "2026-10", monthSpendMicroUsd: 1_840_000, globalEnabled: true, dayKey: null, recordSummariesToday: 0 },
}));
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => { fx.reads.push("guard"); if (!fx.agency) throw new Error("NEXT_REDIRECT"); return { userId: "u" }; },
}));
const REQ = { tag: "request" };
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    ...REQ,
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => { fx.reads.push("accounts"); return { data: { timezone: "America/Chicago", language: null }, error: null }; } };
      return chain;
    },
  }),
}));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: fx.prefsLanguage }) }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAiSettings: async (db: { tag: string }) => { fx.reads.push(`settings:${db.tag}`); if (fx.fail) throw new Error("read failed"); return fx.settings; },
  countAiSkipsSince: async (db: { tag: string }) => { fx.reads.push(`refusals:${db.tag}`); return 0; },
  firstOverBudgetSince: async (db: { tag: string }) => { fx.reads.push(`overBudget:${db.tag}`); return null; },
}));
vi.mock("./ai-actions", () => ({ saveAccountAiAction: async () => ({}), undoAccountAiAction: async () => ({}), setGlobalAiAction: async () => ({}) }));

const { AiSection } = await import("./ai-section");
const { AiCard, AiCardError } = await import("./ai-card");

beforeEach(() => {
  fx.agency = true; fx.reads = []; fx.fail = false; fx.prefsLanguage = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The fixture's monthKey is "2026-10": pin "now" inside that month so the spend line is this month's.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T15:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("AiSection (spec 3.6; plan deviations 14, 16)", () => {
  it("guards first: a non-agency caller is redirected before any read, never shown the error card (mutation: guard inside the try -> FAILS)", async () => {
    fx.agency = false;
    await expect(AiSection({ accountId: "a1" })).rejects.toThrow("NEXT_REDIRECT");
    expect(fx.reads).toEqual(["guard"]);
  });

  it("reads on the REQUEST client and hands the card its view and bound actions (mutation: read on serviceDb() -> FAILS)", async () => {
    const el = (await AiSection({ accountId: "a1" })) as ReactElement<Record<string, unknown>>;
    expect(isValidElement(el) && el.type).toBe(AiCard);
    expect(fx.reads.filter((r) => r.includes(":"))).toEqual(["settings:request", "refusals:request", "overBudget:request"]);
    expect((el.props.view as { spendLine: string | null }).spendLine).toBe("$1.84 of $10.00 this month, estimated");
    expect(el.props.locale).toBe("en");
    expect([typeof el.props.save, typeof el.props.undo, typeof el.props.setGlobal]).toEqual(["function", "function", "function"]);
  });

  it("keys the card on the stored switch and budget, so a Save's or an Undo's refresh resets the form (review I8; mutation: drop the key -> FAILS)", async () => {
    const first = (await AiSection({ accountId: "a1" })) as ReactElement;
    expect(first.key).toBe("true:10");
    fx.settings = { ...fx.settings, accountEnabled: false, monthlyBudgetCents: 2500 };
    const after = (await AiSection({ accountId: "a1" })) as ReactElement;
    expect(after.key).toBe("false:25");
    fx.settings = { ...fx.settings, accountEnabled: true, monthlyBudgetCents: 1000 };
  });

  it("speaks the reader's own language (mutation: drop userLanguage from requestLocale -> FAILS)", async () => {
    fx.prefsLanguage = "es";
    const el = (await AiSection({ accountId: "a1" })) as ReactElement<Record<string, unknown>>;
    expect(el.props.locale).toBe("es");
    expect((el.props.view as { spendLine: string | null }).spendLine).toBe("$1.84 de $10.00 este mes, estimado");
  });

  it("a failed read is the card's own error, logged with the account (mutation: rethrow -> FAILS)", async () => {
    fx.fail = true;
    const el = (await AiSection({ accountId: "a1" })) as ReactElement<Record<string, unknown>>;
    expect(isValidElement(el) && el.type).toBe(AiCardError);
    expect(String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe("settings: AI card unavailable for account a1: Error: read failed");
  });
});
