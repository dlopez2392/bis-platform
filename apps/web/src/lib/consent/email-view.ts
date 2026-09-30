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
export type EmailHow = { kind: "unsubscribe_link" } | { kind: "staff" } | { kind: "backfill_0049" };

export type EmailView =
  | { kind: "no_email" }
  | { kind: "allowed"; newestId: string | null }
  | { kind: "stopped"; eventId: string; since: string; how: EmailHow; canResume: boolean };

/** Choice 19: staff may resume only a stop staff recorded, or 0049's folded switch. */
export const EMAIL_RESUMABLE_METHODS: readonly ConsentMethod[] = ["staff", "backfill_0049"];

export function emailHowOf(method: ConsentMethod): EmailHow {
  switch (method) {
    case "unsubscribe_link":
    case "one_click":
    case "unsubscribe_page": return { kind: "unsubscribe_link" };
    case "backfill_0049": return { kind: "backfill_0049" };
    default: return { kind: "staff" };
  }
}

export function emailViewOf(rows: readonly ConsentHistoryRow[], hasAddress: boolean): EmailView {
  if (!hasAddress) return { kind: "no_email" };
  const state = consentStateOf(rows);
  if (state.state !== "allowed") {
    return {
      kind: "stopped", eventId: state.eventId, since: state.since, how: emailHowOf(state.method),
      canResume: state.state === "stopped" && EMAIL_RESUMABLE_METHODS.includes(state.method),
    };
  }
  return { kind: "allowed", newestId: newestDecidingRow(rows)?.id ?? null };
}

/** The contact's Email row, read. THROWS on an unreadable ledger (the row shows its error line). */
export async function readEmailView(db: SupabaseClient, accountId: string, contact: { email: string | null }): Promise<EmailView> {
  const address = emailLedgerAddress(contact.email);
  if (!address) return { kind: "no_email" };
  return emailViewOf(await readConsentHistory(db, accountId, "email", address), true);
}
