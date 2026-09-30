import { appendConsentEventGuarded, type FormField, type SupabaseClient } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { loggableError } from "@/lib/loggable-error";

/**
 * Grants where BIS already captures them (spec decision 8, §4.2 "Grants"):
 * a ticked form consent field, and a booking made with a phone. (The third,
 * a customer texting first, is the inbound route's, lib/consent/inbound.ts.)
 *
 * Evidence ONLY: a grant never lifts a stop (choice 28) and nothing requires
 * one before sending (choice 29), so a write that fails is logged and the
 * lead or the booking goes on. Each is written once per address per source
 * (0055's one row per source): a re-run appends nothing.
 */
export type FormConsentEntry = { key: string; given: boolean; text: string; at: string };

function answerOf(fields: FormField[], answers: { key: string; value: string }[], kind: FormField["kind"]): string {
  const field = fields.find((f) => f.kind === kind);
  return field ? (answers.find((a) => a.key === field.key)?.value ?? "").trim() : "";
}

export async function recordFormGrants(
  db: SupabaseClient,
  input: {
    accountId: string; formId: string; submissionId: string;
    fields: FormField[]; answers: { key: string; value: string }[]; consent: FormConsentEntry[] | null;
  },
): Promise<void> {
  const ticked = (input.consent ?? []).filter((c) => c.given);
  if (ticked.length === 0) return;
  const sms = normalisePhone(answerOf(input.fields, input.answers, "core.phone") || null)?.e164 ?? null;
  const typedEmail = answerOf(input.fields, input.answers, "core.email").toLowerCase();
  const email = typedEmail.indexOf("@") > 0 ? typedEmail : null;
  // Together, not one after another: this runs on the public submit path
  // (review R2-m16). Each write is contained on its own.
  const writes: Promise<void>[] = [];
  for (const c of ticked) {
    for (const [channel, address] of [["sms", sms], ["email", email]] as const) {
      if (!address) continue;
      writes.push(appendConsentEventGuarded(db, {
        accountId: input.accountId, channel, address, action: "granted", method: "form",
        sourceRef: `form_submission:${input.submissionId}:${c.key}`,
        evidence: { form_id: input.formId, submission_id: input.submissionId, field: c.key, label: c.text },
      }, "none").then(() => undefined, (e: unknown) => {
        console.error(`form grant for submission ${input.submissionId} not recorded: ${loggableError(e)}`);
      }));
    }
  }
  await Promise.all(writes);
}

export async function recordBookingGrant(
  db: SupabaseClient,
  input: { accountId: string; bookingId: string; contactId: string; phoneAsTyped: string | null },
): Promise<void> {
  const address = normalisePhone(input.phoneAsTyped || null)?.e164;
  if (!address) return;
  try {
    await appendConsentEventGuarded(db, {
      accountId: input.accountId, channel: "sms", address, action: "granted", method: "booking",
      contactId: input.contactId, sourceRef: `booking:${input.bookingId}`, evidence: { booking_id: input.bookingId },
    }, "none");
  } catch (e) {
    console.error(`booking grant for booking ${input.bookingId} not recorded: ${loggableError(e)}`);
  }
}
