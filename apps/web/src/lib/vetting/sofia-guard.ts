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
 *
 * `locale` defaults to English ON PURPOSE, and every caller today takes the default: the Voice and Setup
 * actions refuse in English, like every other refusal those actions return (voice.*, setup.* copy). The
 * Voice page shows the same sentence in the operator's language beside the locked switch before anyone
 * presses it; carrying that language through those actions is a separate change (final review M5).
 *
 * What this guard does NOT close, all accepted (agency-only writers; each needs a check inside the
 * database - a trigger or a locking function - which this release does not add):
 * - Check-then-write against the Trade card (settings/trade-actions.ts): a switch-on and a move to a
 *   CRM-only trade sent in the same instant can both pass, leaving a CRM-only company with Sofía on.
 * - Two writes that are each allowed alone can race INTO answering (T5 review m1): tab A saves the first
 *   voice profile while the number is provisioned (no number answers: not a switch-on), tab B moves that
 *   number provisioned -> testing having read "no profile" (nothing answers: not a switch-on either).
 *   Together, a testing number now answers, and neither guard saw a switch-on.
 * - enableConciergeAction asks this guard unconditionally, so it would also refuse "re-enabling" a chat
 *   that is already on for a CRM-only or no-trade company (T5 review m3). No UI path sends that (the card
 *   calls it only while the chat is off), and the chat stays on - it never turns anything off.
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
