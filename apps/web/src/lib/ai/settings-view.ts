import { MAX_MONTHLY_BUDGET_CENTS, type AiSettingsRead } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { plural, t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { periodKeys } from "./period";

/** Whole dollars, 0-1000, an optional leading "$" (plan deviation 17). Cents, or null. */
export function parseBudgetDollars(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^\$\s*/, "");
  if (!/^\d{1,4}$/.test(s)) return null;
  const cents = Number(s) * 100;
  return cents <= MAX_MONTHLY_BUDGET_CENTS ? cents : null;
}

/** The typed word that turns AI off for every account (choice I12): the catalogue's, in either language. */
export function isConfirmWord(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const w = raw.trim().toUpperCase();
  return w === m["aiSettings.global.confirmWord"] || w === m["aiSettings.global.confirmWord.es"];
}

export type AiCardView = {
  accountEnabled: boolean; budgetDollars: string; globalEnabled: boolean;
  spendLine: string | null; reachedLine: string | null; skippedLine: string | null;
};

/** Intl's no-break and narrow no-break spaces as plain spaces, so a line reads (and compares) as typed. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

/**
 * The agency's AI card (spec 3.6), in the reader's language. The month is the account's own (choice I7): spend
 * stored under another month reads as none, as the gate reads it. Spend is rounded UP to the cent, so a little use
 * never reads as $0.00. "Reached" is spend >= budget, the gate's own test; its day is the month's first over-budget
 * ledger row (plan deviation 15).
 */
export function aiCardView(i: {
  settings: AiSettingsRead; refusals: number; overBudgetAt: string | null; now: Date; zone: string; locale: Locale;
}): AiCardView {
  const tag = i.locale === "es" ? "es-US" : "en-US";
  const money = (cents: number) => plain(new Intl.NumberFormat(tag, { style: "currency", currency: "USD" }).format(cents / 100));
  const day = (d: Date) => plain(new Intl.DateTimeFormat(tag, { timeZone: i.zone, month: "short", day: "numeric" }).format(d));
  const s = i.settings;
  const { monthKey } = periodKeys(i.now, i.zone);
  const spent = s.monthKey === monthKey ? s.monthSpendMicroUsd : 0;
  // The 1st of next month, built from the account's own month key at NOON UTC and printed in UTC (review M4): a
  // calendar date, so no zone's midnight (a DST change AT midnight on the 1st, as Asuncion's 2023-10-01) can move it.
  const [y, mo] = monthKey.split("-").map(Number) as [number, number];
  const resumeAt = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1, 12));
  const resume = plain(new Intl.DateTimeFormat(tag, { timeZone: "UTC", month: "short", day: "numeric" }).format(resumeAt));
  const reached = spent >= s.monthlyBudgetCents * 10_000;
  return {
    accountEnabled: s.accountEnabled,
    budgetDollars: String(s.monthlyBudgetCents / 100),
    globalEnabled: s.globalEnabled,
    spendLine: spent > 0 || i.refusals > 0
      ? t(m, "aiSettings.spend", i.locale, { spent: money(Math.ceil(spent / 10_000)), budget: money(s.monthlyBudgetCents) })
      : null,
    // A $0 budget is reached by every spend, $0 included (the gate refuses spend >= budget), so it never resumes on
    // the 1st: it stays off until someone raises the budget (fix round 3).
    reachedLine: !reached ? null
      : s.monthlyBudgetCents === 0 ? t(m, "aiSettings.zeroBudget", i.locale)
      : i.overBudgetAt ? t(m, "aiSettings.reached", i.locale, { date: day(new Date(i.overBudgetAt)), resume })
      : t(m, "aiSettings.reachedNoDate", i.locale, { resume }),
    skippedLine: i.refusals > 0 ? plural(m, "aiSettings.skipped", i.refusals, i.locale, { count: i.refusals }) : null,
  };
}
