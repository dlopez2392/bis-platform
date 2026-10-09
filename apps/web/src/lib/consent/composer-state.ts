import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";

/**
 * Whether the text composer may text this contact, and the one line it shows
 * in place of the form when it may not (consent chain spec §6). PURE: the
 * composer is a client component; the read that produces the state is
 * recipient-state.ts, on the server.
 *
 * The line is decided on RENDER (the composer is disabled up front) AND the
 * action says the same thing after an attempt (a stale tab, or a stop that
 * landed since the page rendered): both come from here, so the two can never
 * disagree. The action has no date to offer, so its stopped line is undated.
 */
export type SmsRecipientState =
  | { kind: "ok" }
  | { kind: "stopped"; since: string }
  | { kind: "held"; since: string }
  | { kind: "unconfirmed_number" }
  | { kind: "unknown" };

/** The line a refused send reports, from the action (no date to hand). */
export function composerBlockedLine(
  reason: "stopped" | "held" | "unconfirmed_number" | "window_after_deadline" | "stop_confirmation_stale",
): string {
  switch (reason) {
    case "stopped": return m["compose.smsStoppedUndated"];
    case "held": return m["compose.smsHeld"];
    case "unconfirmed_number": return m["compose.smsCheckNumber"];
    // Neither reaches a staff text (no deadline, not a stop confirmation):
    // typed for the gate's full reason list, worded as a plain failure.
    case "window_after_deadline": return m["compose.smsFailed"];
    case "stop_confirmation_stale": return m["compose.smsFailed"];
  }
}

/**
 * The line the composer shows instead of the text form, or null when the
 * form shows. `zone` is the account's (the date is a calendar day there); a
 * stop date that will not format falls back to the undated line rather than
 * throwing inside a render.
 */
export function composerStateLine(state: SmsRecipientState, zone: string): string | null {
  switch (state.kind) {
    case "ok": return null;
    case "stopped": {
      let date: string | null = null;
      try {
        date = formatDateInZone(state.since, zone);
      } catch {
        date = null;
      }
      return date === null ? m["compose.smsStoppedUndated"] : m["compose.smsStopped"].replace("{date}", date);
    }
    case "held": return m["compose.smsHeld"];
    case "unconfirmed_number": return m["compose.smsCheckNumber"];
    case "unknown": return m["compose.smsStateUnknown"];
  }
}

/** The email composer's read (recipient-state.ts): who stopped their email,
 *  if anyone. `suppressed` is set only for D-016's two provider facts (a
 *  hard bounce or a complaint) — neither a customer's nor staff's CHOICE,
 *  so neither reads `byCustomer`. */
export type EmailRecipientState =
  | { kind: "ok" }
  | { kind: "stopped"; since: string; byCustomer: boolean; suppressed?: "bounced" | "complained" }
  | { kind: "unknown" };

/**
 * The ONE line the email composer shows above the subject, or null (spec §6,
 * choice 22; plan G15). The composer stays usable: a person writing about
 * the customer's own matter is not automated mail. The spec's line for the
 * customer's own unsubscribe; "You stopped …" for a staff or folded stop,
 * where "They unsubscribed" would be false; D-016's suppressed line for a
 * hard bounce or a complaint, checked first — the provider's own fact about
 * the address, which is neither of those two. A date that will not format
 * drops the date rather than throwing inside a render.
 */
export function composerEmailNotice(state: EmailRecipientState, zone: string): string | null {
  if (state.kind === "ok") return null;
  if (state.kind === "unknown") return m["compose.emailStateUnknown"];
  const line = state.suppressed === "bounced" ? m["compose.emailBounced"]
    : state.suppressed === "complained" ? m["compose.emailComplained"]
    : state.byCustomer ? m["compose.emailUnsubscribed"] : m["compose.emailStoppedByYou"];
  try {
    return line.replace("{date}", formatDateInZone(state.since, zone));
  } catch {
    return line.replace(" on {date}", "");
  }
}
