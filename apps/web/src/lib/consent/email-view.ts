import {
  consentStateOf, newestDecidingRow, readConsentHistory,
  type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
} from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";

/**
 * The contact's Email row (consent chain spec §6, PR-3), as data: what the
 * ledger says about their email address. Allowed or Stopped — email has no
 * holds (no free-text detection reads email), so a held row, which nothing
 * writes, reads as Stopped with no Resume. Server-only; the row imports only
 * the TYPES.
 */
export type EmailHow =
  | { kind: "unsubscribe_link" } | { kind: "staff" } | { kind: "backfill_0049" }
  // D-016 (0062): the provider's own facts about the address, never a
  // CHOICE anyone made — so each is its OWN kind, not the "staff" default
  // (which the drawer would otherwise say for them, reading as "you did
  // this"). Resumable only by the customer's own resubscribe: neither name
  // is in EMAIL_RESUMABLE_METHODS below.
  | { kind: "bounced" } | { kind: "complained" }
  // S-06 part 1 (plan G9): a clear stop keyword in a customer's own reply —
  // their own choice, like unsubscribe_link, but not the SAME choice (no
  // link was clicked), so its own kind. Lifted only by its Undo (0082) or
  // the customer's own resubscribe: not in EMAIL_RESUMABLE_METHODS. `expired`
  // (fix round 1, the execution note): true once the stop is 7 days old or
  // more, at which point only the customer's own resubscribe can lift it —
  // the row's explanation changes, even though canResume stays false either
  // way.
  | { kind: "reply"; expired: boolean };

export type EmailView =
  | { kind: "no_email" }
  | { kind: "allowed"; newestId: string | null }
  | { kind: "stopped"; eventId: string; since: string; how: EmailHow; canResume: boolean };

/** Choice 19: staff may resume only a stop staff recorded, or 0049's folded switch. */
export const EMAIL_RESUMABLE_METHODS: readonly ConsentMethod[] = ["staff", "backfill_0049"];

/** The owner's 7-day staff-Undo window on an emailed stop (0082's own function; fix round 1). */
export const REPLY_STOP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function emailHowOf(method: ConsentMethod, replyExpired = false): EmailHow {
  switch (method) {
    case "unsubscribe_link":
    case "one_click":
    case "unsubscribe_page": return { kind: "unsubscribe_link" };
    case "backfill_0049": return { kind: "backfill_0049" };
    case "email_bounce": return { kind: "bounced" };
    case "email_complaint": return { kind: "complained" };
    case "inbound_email": return { kind: "reply", expired: replyExpired };
    default: return { kind: "staff" };
  }
}

/** `now` defaults to the real clock; a caller that needs a deterministic boundary (a test, or a
 *  render that must agree with a value already computed) passes its own. */
export function emailViewOf(rows: readonly ConsentHistoryRow[], hasAddress: boolean, now: Date = new Date()): EmailView {
  if (!hasAddress) return { kind: "no_email" };
  const state = consentStateOf(rows);
  if (state.state !== "allowed") {
    const expired = state.method === "inbound_email" && now.getTime() - Date.parse(state.since) >= REPLY_STOP_WINDOW_MS;
    return {
      kind: "stopped", eventId: state.eventId, since: state.since, how: emailHowOf(state.method, expired),
      canResume: state.state === "stopped" && EMAIL_RESUMABLE_METHODS.includes(state.method),
    };
  }
  return { kind: "allowed", newestId: newestDecidingRow(rows)?.id ?? null };
}

/** The contact's Email row, read. THROWS on an unreadable ledger (the row shows its error line).
 *  `db` is the ledger client (ledgerDb(), F-085 spec §7.3), passed only after the contact was
 *  proven on the caller's own client: the history is keyed by address, not by contact. */
export async function readEmailView(
  db: SupabaseClient, accountId: string, contact: { email: string | null }, now: Date = new Date(),
): Promise<EmailView> {
  const address = emailLedgerAddress(contact.email);
  if (!address) return { kind: "no_email" };
  return emailViewOf(await readConsentHistory(db, accountId, "email", address), true, now);
}
