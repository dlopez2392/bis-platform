import { serviceDb, getAccountTrade } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { sofiaGate } from "./trades";
import { sofiaGateText } from "./copy";

/**
 * The ONE trade check every action that SWITCHES Sofía or the web chat ON calls, once switchesSofiaOn
 * (sofia-state.ts) says the write would (spec 5.3). Returns null when the company's trade allows it, else
 * the sentence to refuse with. Fails CLOSED: an unreadable trade refuses (the operator presses again).
 * Agency-only callers (every one checks isAgency / requireAgency first), hence serviceDb.
 */
export async function sofiaSwitchOnRefusal(accountId: string, locale: Locale = "en"): Promise<string | null> {
  let trade: string | null;
  try {
    ({ trade } = await getAccountTrade(serviceDb(), accountId));
  } catch (e) {
    console.error(`sofiaSwitchOnRefusal: trade read failed for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return t(m, "vetting.readFailed", locale);
  }
  const gate = sofiaGate(trade);
  return gate.ok ? null : sofiaGateText(gate, locale);
}
