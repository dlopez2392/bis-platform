/**
 * The vetting sentences, resolved for one language (and the QA pseudo-locale). trades.ts holds the
 * entries' own words (labels, reasons); lib/messages.ts holds the sentences around them; this joins the
 * two so every caller - the picker, the server actions, the Voice and Setup pages - says the same thing.
 */
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";
import { TRADE_ENTRIES, TRADE_GROUPS, tradeLabel, type SofiaGate, type TradeChoiceCheck } from "./trades";

export type TradeOption = { value: string; label: string };
export type TradeOptionGroup = { key: string; label: string; options: TradeOption[] };

/** Every trade, grouped as in the spec's table, labelled in `locale`. Held and turned-away trades are
 *  listed too: the agency picks what the business does, and the server answers with the reason. */
export function tradeOptionGroups(locale: Locale, pseudo = false): TradeOptionGroup[] {
  const w = (s: string) => (pseudo ? pseudoLocale(s) : s);
  return TRADE_GROUPS.map((g) => ({
    key: g.key,
    label: w(g.label[locale]),
    options: TRADE_ENTRIES.filter((e) => e.group === g.key).map((e) => ({ value: e.key, label: w(e.label[locale]) })),
  }));
}

/** Why a trade choice was refused, in `locale`: a held or turned-away trade's own reason, else the
 *  catalogue's "choose a trade" / "describe the business" sentence. */
export function tradeChoiceRefusal(check: Extract<TradeChoiceCheck, { ok: false }>, locale: Locale): string {
  if (check.problem === "not_creatable") return check.entry.reason?.[locale] ?? t(m, "vetting.error.missing", locale);
  return t(m, check.problem === "missing" ? "vetting.error.missing" : "vetting.error.otherDescription", locale);
}

/** Why Sofía and the web chat cannot be switched on, in `locale`. A CRM-only trade is named in lower
 *  case inside the sentence ("for restaurant businesses", "para el giro restaurante"). */
export function sofiaGateText(gate: Extract<SofiaGate, { ok: false }>, locale: Locale, pseudo = false): string {
  const s = gate.reason === "crm_only"
    ? t(m, "vetting.sofia.crmOnly", locale, {
      trade: (tradeLabel(gate.trade, locale) ?? gate.trade).toLocaleLowerCase(locale),
    })
    : t(m, "vetting.sofia.noTrade", locale);
  return pseudo ? pseudoLocale(s) : s;
}
