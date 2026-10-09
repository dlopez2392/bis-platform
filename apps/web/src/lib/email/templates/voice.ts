import { shell, button, escapeHtml, type EmailBrand } from "./shell";

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
};

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
  // The call-back line LEADS: who to call and why is the three-second read
  // the owner opens this for. Escaped like the summary — the reason is the
  // caller's request in the receptionist's words.
  const lead = input.callback
    ? `<p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(input.callback)}</p>`
    : "";
  const html = shell(input.brand, `${lead}
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">Call — ${escapeHtml(input.outcome)}</p>
    <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(input.callerDisplay)}</p>
    <div style="margin:0 0 20px;white-space:pre-wrap;">${escapeHtml(input.summary)}</div>
    ${input.contactUrl ? button(input.brand, input.contactUrl, "Open this contact") : ""}
  `);

  // Composed, never derived by stripping tags — the version a human would
  // have written, and what a text-only client shows.
  const text = [
    ...(input.callback ? [input.callback, ""] : []),
    `Call — ${input.outcome}`,
    input.callerDisplay,
    "",
    input.summary,
    ...(input.contactUrl ? ["", `Open this contact: ${input.contactUrl}`] : []),
  ].join("\n");

  return { html, text };
}
