import { describe, it, expect } from "vitest";
import type { AiSettingsRead } from "@bis/db";
import { aiCardView, isConfirmWord, parseBudgetDollars } from "./settings-view";
import { periodKeys } from "./period";

/** Spec 3.6; plan deviations 15, 17. Intl outputs read with node (plan, "Read, not assumed"). */
const NOW = new Date("2026-10-18T15:00:00Z");
const ZONE = "America/Chicago";
const settings = (o: Partial<Parameters<typeof aiCardView>[0]["settings"]> = {}) =>
  ({ accountEnabled: true, monthlyBudgetCents: 1000, monthKey: "2026-10", monthSpendMicroUsd: 0, globalEnabled: true, dayKey: null, recordSummariesToday: 0, ...o });

describe("parseBudgetDollars (plan deviation 17)", () => {
  it.each([["10", 1000], ["$25", 2500], [" 1000 ", 100000], ["0", 0], ["$ 7", 700]])("%j -> %i cents", (raw, cents) => {
    expect(parseBudgetDollars(raw)).toBe(cents);
  });
  it.each(["", "abc", "1001", "-5", "10.50", "1e3", "12345", null, 25])("%j -> refused (mutation: allow cents or drop the 1000 cap -> FAILS)", (raw) => {
    expect(parseBudgetDollars(raw)).toBeNull();
  });
});

describe("isConfirmWord (choice I12)", () => {
  it("OFF or APAGAR, trimmed, any case; nothing else (mutation: accept any non-empty text -> FAILS)", () => {
    expect([isConfirmWord("OFF"), isConfirmWord(" off "), isConfirmWord("apagar"), isConfirmWord("of"), isConfirmWord(""), isConfirmWord(undefined)])
      .toEqual([true, true, true, false, false, false]);
  });
});

describe("aiCardView (spec 3.6)", () => {
  it("this month's spend in words, rounded up to the cent, in both languages (mutation: Math.floor -> $1.83 -> FAILS)", () => {
    const v = (locale: "en" | "es") => aiCardView({ settings: settings({ monthSpendMicroUsd: 1_830_001 }), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale });
    expect([v("en").spendLine, v("es").spendLine]).toEqual(["$1.84 of $10.00 this month, estimated", "$1.84 de $10.00 este mes, estimado"]);
  });

  it("no use this month is the empty state, even with spend stored for LAST month (mutation: ignore monthKey -> FAILS)", () => {
    const v = aiCardView({ settings: settings({ monthKey: "2026-09", monthSpendMicroUsd: 5_000_000 }), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale: "en" });
    expect([v.spendLine, v.reachedLine, v.skippedLine]).toEqual([null, null, null]);
  });

  it("budget reached names the day it happened and the 1st it resumes, in the account's zone (plan deviation 15; mutation: resume on the 1st in UTC -> FAILS)", () => {
    const v = (locale: "en" | "es", at: string | null) => aiCardView({ settings: settings({ monthSpendMicroUsd: 10_000_000 }), refusals: 2, overBudgetAt: at, now: NOW, zone: ZONE, locale });
    expect([v("en", "2026-10-14T15:00:00Z").reachedLine, v("es", "2026-10-14T15:00:00Z").reachedLine]).toEqual([
      "Budget reached on Oct 14. Summaries, cards and suggestions are paused for this account until Nov 1.",
      "Presupuesto alcanzado el 14 oct. Los resúmenes, las tarjetas y las sugerencias están en pausa en esta cuenta hasta el 1 nov.",
    ]);
    expect(v("en", null).reachedLine).toBe("Budget reached. Summaries, cards and suggestions are paused for this account until Nov 1.");
  });

  it("the resume day is the 1st of next month even where that 1st has no local midnight, and across a year end (review M4; mutation: the old monthStartInZone(+32 days) arithmetic printed in the zone -> FAILS on Asuncion)", () => {
    // A real reached state (fix round 3): the default $10 budget, spent in the zone's own month. A $0 budget is
    // its own sentence (below), never a resume date.
    const resume = (now: string, zone: string, monthKey: string) =>
      aiCardView({ settings: settings({ monthKey, monthSpendMicroUsd: 10_000_000 }), refusals: 0, overBudgetAt: null, now: new Date(now), zone, locale: "en" }).reachedLine;
    // America/Asuncion sprang forward AT local midnight on 2023-10-01 (00:00 -> 01:00, read with node 24): that
    // day's midnight does not exist, which is what the old arithmetic tripped on.
    expect(resume("2023-09-15T12:00:00Z", "America/Asuncion", "2023-09")).toBe("Budget reached. Summaries, cards and suggestions are paused for this account until Oct 1.");
    // America/Santiago's 2026 changes fall on Apr 4/5 and Sep 5/6 (not on a 1st): kept as ordinary-month rows.
    expect(resume("2026-09-05T12:00:00Z", "America/Santiago", "2026-09")).toBe("Budget reached. Summaries, cards and suggestions are paused for this account until Oct 1.");
    expect(resume("2026-04-04T12:00:00Z", "America/Santiago", "2026-04")).toBe("Budget reached. Summaries, cards and suggestions are paused for this account until May 1.");
    // Year end: 21:00 on Dec 31 in Chicago is already January in UTC, so a resume built from the UTC month would
    // read Feb 1; the account's own month says Jan 1 (mutation: build the resume from periodKeys(now, "UTC") -> FAILS).
    expect(resume("2027-01-01T03:00:00Z", ZONE, "2026-12")).toBe("Budget reached. Summaries, cards and suggestions are paused for this account until Jan 1.");
    // Year end where the zone is still December and the resume must not read as the same year's January.
    expect(resume("2026-12-15T12:00:00Z", "America/Asuncion", "2026-12")).toBe("Budget reached. Summaries, cards and suggestions are paused for this account until Jan 1.");
  });

  it("a $0 budget is off until it is raised, never paused until the 1st, spent or not, in both languages (fix round 3: the gate refuses spend >= budget, so $0 never resumes; mutation: drop the zero-budget branch -> FAILS)", () => {
    const v = (spend: number, locale: "en" | "es") =>
      aiCardView({ settings: settings({ monthlyBudgetCents: 0, monthSpendMicroUsd: spend }), refusals: 0, overBudgetAt: spend > 0 ? "2026-10-14T15:00:00Z" : null, now: NOW, zone: ZONE, locale }).reachedLine;
    expect([v(0, "en"), v(0, "es"), v(500_000, "en")]).toEqual([
      "Budget is $0. Summaries, cards and suggestions are off for this account until the budget is raised.",
      "El presupuesto es $0. Los resúmenes, las tarjetas y las sugerencias están apagados en esta cuenta hasta que se suba el presupuesto.",
      "Budget is $0. Summaries, cards and suggestions are off for this account until the budget is raised.",
    ]);
  });

  it("one micro-dollar under the budget is not reached (mutation: `>` -> `>=` on budget - 1 -> FAILS)", () => {
    expect(aiCardView({ settings: settings({ monthSpendMicroUsd: 9_999_999 }), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale: "en" }).reachedLine).toBeNull();
  });

  it("how often AI was skipped, once and many (choice I10; mutation: drop the One form -> FAILS)", () => {
    const v = (n: number, locale: "en" | "es") => aiCardView({ settings: settings(), refusals: n, overBudgetAt: null, now: NOW, zone: ZONE, locale }).skippedLine;
    expect([v(1, "en"), v(3, "es"), v(0, "en")]).toEqual([
      "One of them was skipped this month because this account's AI was off or over budget.",
      "Se omitieron 3 de ellos este mes porque la IA de esta cuenta estaba apagada o sin presupuesto.",
      null,
    ]);
  });

  it("the switches and the budget as the field shows it (mutation: budgetDollars in cents -> FAILS)", () => {
    const v = aiCardView({ settings: settings({ accountEnabled: false, monthlyBudgetCents: 2500, globalEnabled: false }), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale: "en" });
    expect([v.accountEnabled, v.budgetDollars, v.globalEnabled]).toEqual([false, "25", false]);
  });
});

describe("item 8a-2: today's customer summaries (spec 3.6, 4.6; plan deviation 17)", () => {
  it("today's count against the cap, in both languages; another day's count reads as none; zero hides the line (mutations: ignore dayKey -> yesterday's 7 shows -> FAILS; show '0 of 200' -> FAILS)", () => {
    const today = (locale: "en" | "es", o: Partial<AiSettingsRead>) => aiCardView({ settings: settings(o), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale }).summariesLine;
    const { dayKey } = periodKeys(NOW, ZONE);
    expect([today("en", { dayKey, recordSummariesToday: 12 }), today("es", { dayKey, recordSummariesToday: 12 })])
      .toEqual(["12 of 200 customer summaries written today", "12 de 200 resúmenes de clientes escritos hoy"]);
    expect(today("en", { dayKey: "2026-01-01", recordSummariesToday: 7 })).toBeNull();
    expect(today("en", { dayKey, recordSummariesToday: 0 })).toBeNull();
  });
});
