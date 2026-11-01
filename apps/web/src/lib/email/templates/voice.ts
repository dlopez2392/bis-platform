import { shell, button, escapeHtml, type EmailBrand } from "./shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

export type VoiceCallAlertInput = {
  brand: EmailBrand;
  outcome: string;
  /** Already composed by `composeSummary`/`summaryFactLine` — this template
   *  formats nothing, it only escapes and lays the string out. */
  summary: string;
  /** "+1956..." when caller ID was captured, else "Unknown caller". */
  callerDisplay: string;
  /** Absolute, or null when no contact was resolved for this call / the
   *  triggering request carried no host. NEVER relative. */
  contactUrl: string | null;
  /**
   * The call card's line, "Call back at {number}: {reason}" — already
   * composed by the caller (lib/voice/call-card.ts, the callback To do's own
   * title) from what Sofía wrote down on the call. Absent or null: the alert
   * is exactly what it was before the card (owner ruling, 2026-10-09).
   */
  callback?: string | null;
  /** S-10 T8: `accounts.language ?? "en"` — one email, one language, subject
   *  through footer (spec §3.3). English when absent. Unrelated to what the
   *  caller spoke or to the profile's own language. */
  locale?: Locale;
};

/** The three outcomes `isMeaningful` (lib/voice/finish-call.ts) ever narrows
 *  to. `outcome` on the input above is the wider `string` the summary/call
 *  types already carry, so an outcome outside this map falls back to the raw
 *  value rather than throwing — the same runtime-floor posture
 *  `composeCallAlertSms`'s CALL_ALERT_LEAD takes for the identical union
 *  (lib/sms/alerts.ts). */
const OUTCOME_KEY: Record<string, keyof typeof m> = {
  booked: "email.callAlert.outcome.booked",
  lead: "email.callAlert.outcome.lead",
  message: "email.callAlert.outcome.message",
};

function outcomeWord(outcome: string, locale: Locale): string {
  const key = OUTCOME_KEY[outcome];
  return key ? t(m, key, locale) : outcome;
}

/** The subject line, "Call — {outcome} — {caller}" in the account's own
 *  language — built here so the one place that knows the outcome's three
 *  translated words is also the one place that spells the subject. */
export function voiceCallAlertSubject(outcome: string, callerDisplay: string, locale: Locale = "en"): string {
  const heading = t(m, "email.callAlert.heading", locale, { outcome: outcomeWord(outcome, locale) });
  return `${heading} — ${callerDisplay}`;
}

/**
 * The email a client's staff gets after a voice call finishes.
 *
 * Operator-facing, like `bookingAlertEmail`/`leadAlertEmail`: it lands in the
 * client's own inbox, so it can spend structure freely. The summary is
 * multi-line (fact line, optional mismatch warning, prose) and attacker-
 * influenced (a caller's own words can end up in it via the model), so it is
 * escaped and rendered with `white-space:pre-wrap` rather than collapsed into
 * one paragraph — the line breaks that make the fact line, the mismatch
 * warning, and the prose readable as separate things must survive into the
 * sent mail.
 */
export function voiceCallAlertEmail(input: VoiceCallAlertInput): { html: string; text: string } {
  const locale = input.locale ?? "en";
  const heading = t(m, "email.callAlert.heading", locale, { outcome: outcomeWord(input.outcome, locale) });
  const openContact = t(m, "email.alert.openContact", locale);

  // The call-back line LEADS: who to call and why is the three-second read
  // the owner opens this for. Escaped like the summary — the reason is the
  // caller's request in the receptionist's words.
  const lead = input.callback
    ? `<p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(input.callback)}</p>`
    : "";
  const html = shell(input.brand, `${lead}
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(heading)}</p>
    <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(input.callerDisplay)}</p>
    <div style="margin:0 0 20px;white-space:pre-wrap;">${escapeHtml(input.summary)}</div>
    ${input.contactUrl ? button(input.brand, input.contactUrl, openContact) : ""}
  `);

  // Composed, never derived by stripping tags — the version a human would
  // have written, and what a text-only client shows.
  const text = [
    ...(input.callback ? [input.callback, ""] : []),
    heading,
    input.callerDisplay,
    "",
    input.summary,
    ...(input.contactUrl ? ["", `${openContact}: ${input.contactUrl}`] : []),
  ].join("\n");

  return { html, text };
}
