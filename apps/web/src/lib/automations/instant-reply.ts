import {
  getAutomation, parseInstantReplyConfig, hasRecentOutboundSms, countInstantRepliesSince,
  stampInstantReplySent, type SupabaseClient,
} from "@bis/db";
import { resolveSmsSender } from "@/lib/sms/sender";
import {
  AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS, INSTANT_REPLY_THREAD_HOLD_MS, INSTANT_REPLY_ALLOWED_PREFIXES,
} from "./caps";
import { lazySmsProvider } from "./harness";
import { sendAutomationSms, markAutomationSmsSent, type SentSms, type SmsSendContext } from "./send-sms";

/**
 * Milestone C — the INLINE recipe: a text to a new web-form lead from the
 * company's own number, the moment their submission lands, in the language
 * they filled the form in. Called ONCE per submission by the public form
 * action (f/[publicId]/actions.ts), last, after the staff alert and the
 * receipt email, inside the action's own try/catch. Not a pass: there is no
 * due-list, no tick, no registry entry.
 *
 * ONE outcome per call, never a throw for a business reason. The free checks
 * (a parsed phone, inside the +1/+52 allowlist, consent not withheld) run
 * before any read; an account with the recipe off pays exactly one indexed
 * read per submission. Then, in order: the A2P gate (the same gate
 * as every send, fails closed) → the 24h per-thread hold (THE double-text
 * guard, new and returning contacts alike; one conversation exists per
 * contact) → the daily cap (25/account/24h, counted on the submission
 * stamp) → the shared write-then-send path → the stamp → mark sent.
 *
 * The body is the SAVED text, sent VERBATIM — nothing composed around it, no
 * name resolved — which is what makes this the one recipe whose send path
 * cannot leak `accounts.name` at all (the sentinel pins it, and
 * InstantReplyInput carries no name for a recipe author to reach).
 *
 * Logging (console.error, the passes' convention): `smsGate`, `dailyCap`,
 * `failed` and an unstamped `sent` — each something an operator or the next
 * session would want to see. `disabled`, `noPhone`, `consentWithheld` and
 * `recentText` are normal and stay silent; `disabled` in particular would
 * otherwise log once per submission for every account without the recipe.
 */
export type InstantReplyInput = {
  db: SupabaseClient;
  /** The submission instant, passed in by the action so the hold and the cap
   *  measure from ONE "now". */
  now: Date;
  accountId: string;
  submissionId: string;
  contactId: string;
  /** The lead's thread — every lead opens one (`enrich`), and one exists per
   *  (account, contact), so a returning contact's second submission lands in
   *  the same thread the hold reads. */
  conversationId: string;
  /** `toE164(rawPhone)`: null when the person typed nothing, or something the
   *  parser could not read. A number stored as typed is NOT textable. */
  phoneE164: string | null;
  /** The submission's normalized locale — the language the person filled the
   *  form in, the receipt email's own signal. Picks the body. */
  locale: "en" | "es";
  /** True when any consent checkbox on the form was left unticked. Required
   *  ones cannot be submitted unticked, so this is an OPTIONAL box a person
   *  deliberately skipped. */
  consentWithheld: boolean;
};

export type InstantReplySkip =
  | "noPhone" | "outsideRegion" | "consentWithheld" | "disabled" | "smsGate" | "recentText" | "dailyCap";

export type InstantReplyOutcome =
  | { kind: "sent"; unstamped: boolean }
  | { kind: "failed"; error: string }
  | { kind: "skipped"; reason: InstantReplySkip; detail?: string };

const WHAT = "instant reply";

export async function sendInstantReply(input: InstantReplyInput): Promise<InstantReplyOutcome> {
  const { db, now, accountId, submissionId } = input;

  // The free checks first — no read for a submission that could never text.
  const to = input.phoneE164;
  if (!to) return { kind: "skipped", reason: "noPhone" };
  // The public form is the one trigger anyone can fire with any number
  // (INSTANT_REPLY_ALLOWED_PREFIXES): outside US/Canada/Mexico, no text.
  if (!INSTANT_REPLY_ALLOWED_PREFIXES.some((prefix) => to.startsWith(prefix))) {
    console.error(`${WHAT} skipped for submission ${submissionId}: ${to} is outside the allowed regions`);
    return { kind: "skipped", reason: "outsideRegion", detail: to };
  }
  if (input.consentWithheld) return { kind: "skipped", reason: "consentWithheld" };

  // ONE indexed read for every account with the recipe off — the whole cost
  // of this feature for a client who never turned it on.
  const row = await getAutomation(db, accountId, "instant_reply");
  if (!row || !row.enabled) return { kind: "skipped", reason: "disabled" };
  const config = parseInstantReplyConfig(row.config);
  if (!config) return { kind: "skipped", reason: "disabled", detail: "invalid config" };
  // Reachable only by a direct database edit — the save action refuses to
  // enable with a blank text — so a guard, not a feature.
  const body = (input.locale === "es" ? config.bodyEs : row.body).trim();
  if (!body) return { kind: "skipped", reason: "disabled", detail: `empty ${input.locale} body` };

  const gate = await resolveSmsSender(db, accountId);
  if (!gate.ok) {
    console.error(`${WHAT} skipped for submission ${submissionId}: account ${accountId} cannot text (${gate.reason})`);
    return { kind: "skipped", reason: "smsGate", detail: gate.reason };
  }

  // Read-then-send, not atomic: two non-identical submissions from one
  // contact landing within the same second can both read "no recent text"
  // and both send (identical answers are already caught by the form's
  // duplicate guard). Bounded by the daily cap; a database-level guard is
  // not worth its weight at this volume — noted here so nobody hunts for it.
  const holdSince = new Date(now.getTime() - INSTANT_REPLY_THREAD_HOLD_MS);
  if (await hasRecentOutboundSms(db, accountId, input.conversationId, holdSince)) {
    return { kind: "skipped", reason: "recentText" };
  }

  const capSince = new Date(now.getTime() - DAILY_CAP_WINDOW_MS).toISOString();
  if (await countInstantRepliesSince(db, accountId, capSince) >= AUTOMATION_DAILY_CAP) {
    console.error(`${WHAT} skipped for submission ${submissionId}: account ${accountId} is at its daily cap (${AUTOMATION_DAILY_CAP}/24h)`);
    return { kind: "skipped", reason: "dailyCap" };
  }

  // The provider comes from the harness's lazy getter and from nowhere else
  // (imports.test.ts): constructed only now, after the send is decided.
  const ctx: SmsSendContext = { db, sms: lazySmsProvider() };
  let sent: SentSms;
  try {
    sent = await sendAutomationSms(ctx, {
      accountId, contactId: input.contactId, to, from: gate.from, body,
      // Nothing retries an instant reply, so there is no attempt marker to write.
      onProviderFailure: async () => {},
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`${WHAT} failed for submission ${submissionId}: ${error}`);
    return { kind: "failed", error };
  }

  // SEND-THEN-STAMP, no retry: the per-thread hold is the double-text guard;
  // the stamp is the cap's evidence — a miss undercounts by one and re-texts
  // no one.
  let unstamped = false;
  try {
    await stampInstantReplySent(db, submissionId);
  } catch (e) {
    unstamped = true;
    console.error(`${WHAT}: text sent but submission ${submissionId} not stamped: ${String(e)}`);
  }
  await markAutomationSmsSent(ctx, accountId, sent, WHAT);
  return { kind: "sent", unstamped };
}
