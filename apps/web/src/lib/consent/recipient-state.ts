import { readConsentState, readEmailSuppression, type SupabaseClient } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { emailLedgerAddress } from "@bis/db/email-address";
import { loggableError } from "@/lib/loggable-error";
import { CUSTOMER_EMAIL_STOP_METHODS } from "./unsubscribe";
import type { SmsRecipientState, EmailRecipientState } from "./composer-state";

/**
 * The contact page's read for the text composer (spec §6): the ledger state
 * of the contact's number and F-009's country flag — the same two facts the
 * send gate checks (gate.ts steps 4 and 5), read under the caller's own
 * client (consent_events grants `authenticated` SELECT under RLS). NEVER
 * throws: a read that fails is `unknown`, which the composer shows as its
 * error line rather than an open form (it fails closed, like the gate).
 *
 * A contact with no textable number is `ok` here: the composer's own "no
 * phone" line already covers it, and a ledger has nothing to key on.
 */
export async function smsRecipientState(
  db: SupabaseClient, accountId: string,
  contact: { phone: string | null; phone_country_unconfirmed?: boolean | null },
): Promise<SmsRecipientState> {
  const number = normalisePhone(contact.phone);
  if (!number) return { kind: "ok" };
  try {
    const state = await readConsentState(db, accountId, "sms", number.e164);
    if (state.state === "stopped") return { kind: "stopped", since: state.since };
    if (state.state === "held") return { kind: "held", since: state.since };
  } catch (e) {
    console.error(`composer: consent state unreadable for account ${accountId}: ${loggableError(e)}`);
    return { kind: "unknown" };
  }
  if (contact.phone_country_unconfirmed === true || number.unconfirmed) return { kind: "unconfirmed_number" };
  return { kind: "ok" };
}

/**
 * The contact page's read for the EMAIL composer (spec §6, choice 22): the
 * ledger state of the contact's address, under the caller's own client.
 * NEVER throws: a read that fails is `unknown`, which the composer states.
 */
export async function emailRecipientState(
  db: SupabaseClient, accountId: string, contact: { email: string | null },
): Promise<EmailRecipientState> {
  const address = emailLedgerAddress(contact.email);
  if (!address) return { kind: "ok" };
  try {
    // D-016 review item 4: a suppression (consent.ts's emailSuppressionOf)
    // is STICKY — only the customer's own resubscribe lifts it, never a
    // later stop by any other method. readConsentState's generic newest-
    // row read does not know that: a one-click unsubscribe written AFTER a
    // bounce/complaint would read as the newest row and say "They
    // unsubscribed", hiding the suppression the gate still blocks on. Read
    // in parallel and checked FIRST, so it wins whenever it answers.
    const [state, suppression] = await Promise.all([
      readConsentState(db, accountId, "email", address),
      readEmailSuppression(db, accountId, address),
    ]);
    if (suppression) {
      return {
        kind: "stopped", since: suppression.since, byCustomer: false,
        suppressed: suppression.method === "email_bounce" ? "bounced" : "complained",
      };
    }
    if (state.state === "allowed") return { kind: "ok" };
    return { kind: "stopped", since: state.since, byCustomer: CUSTOMER_EMAIL_STOP_METHODS.includes(state.method) };
  } catch (e) {
    console.error(`composer: email consent state unreadable for account ${accountId}: ${loggableError(e)}`);
    return { kind: "unknown" };
  }
}
