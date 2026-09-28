import { readConsentState, type SupabaseClient } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { loggableError } from "@/lib/loggable-error";
import type { SmsRecipientState } from "./composer-state";

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
