import {
  getAutomation, parseInstantReplyConfig, hasRecentOutboundSms, countInstantRepliesSince,
  stampInstantReplySent, readQuietSettings, readAccountTimezone, type SupabaseClient,
} from "@bis/db";
import { resolveSmsSender } from "@/lib/sms/sender";
import {
  AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS, INSTANT_REPLY_THREAD_HOLD_MS, INSTANT_REPLY_ALLOWED_PATTERNS,
} from "./caps";
import { lazySmsProvider } from "./harness";
import { sendAutomationSms, markAutomationSmsSent, type SentSms, type SmsSendContext } from "./send-sms";
import {
  holdOrSend, logSkipped, subjectOf, REASONS, type HoldSubject, type LogSubject, type Releaser,
} from "./hold-or-send";

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
 * Logging (console.error, the passes' convention): `outsideRegion` (the
 * submission id and the number's first three characters, never the number),
 * `smsGate`, `dailyCap`, `failed` and an unstamped `sent` — each something
 * an operator or the next session would want to see. `disabled`, `noPhone`,
 * `consentWithheld` and `recentText` are normal and stay silent; `disabled`
 * in particular would otherwise log once per submission for every account
 * without the recipe.
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
  | { kind: "held" }
  | { kind: "failed"; error: string }
  | { kind: "skipped"; reason: InstantReplySkip; detail?: string };

/** What the release needs and the submission row cannot cheaply re-derive.
 *  Written into the held row's `payload`; parsed back, never trusted. */
export type InstantReplyPayload = {
  contactId: string; conversationId: string; phoneE164: string; locale: "en" | "es"; consentWithheld: boolean;
};

export function parseInstantReplyPayload(raw: unknown): InstantReplyPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.contactId !== "string" || typeof p.conversationId !== "string" || typeof p.phoneE164 !== "string") return null;
  if (p.locale !== "en" && p.locale !== "es") return null;
  if (typeof p.consentWithheld !== "boolean") return null;
  return { contactId: p.contactId, conversationId: p.conversationId, phoneE164: p.phoneE164, locale: p.locale, consentWithheld: p.consentWithheld };
}

const WHAT = "instant reply";

export async function sendInstantReply(input: InstantReplyInput): Promise<InstantReplyOutcome> {
  const { db, now, accountId, submissionId } = input;

  // The free checks first — no read for a submission that could never text.
  const to = input.phoneE164;
  if (!to) return { kind: "skipped", reason: "noPhone" };
  // The public form is the one trigger anyone can fire with any number
  // (INSTANT_REPLY_ALLOWED_PATTERNS): outside US/Canada/Mexico, or not the
  // shape of a real number there, no text. The log carries the prefix only —
  // a submitter's phone number is not for the platform's error log.
  if (!INSTANT_REPLY_ALLOWED_PATTERNS.some((pattern) => pattern.test(to))) {
    console.error(`${WHAT} skipped for submission ${submissionId}: destination outside the allowed regions (${to.slice(0, 3)}…)`);
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

  // From here on the recipe is ON, so a refusal is something the client
  // wants to see on the Activity page. Nothing above this line is logged:
  // `disabled` would write a row per lead for every company without the
  // recipe, and `noPhone`/`outsideRegion`/`consentWithheld` are decided
  // BEFORE the recipe is even read, so they are never logged for anyone —
  // SKIP_REASONS' entries for them are reachable only through a
  // hand-edited payload reaching releaseInstantReply directly.
  const logSubject: LogSubject = {
    accountId, source: "instant_reply", channel: "sms", subjectKey: `submission:${submissionId}`, contactId: input.contactId,
  };

  const gate = await resolveSmsSender(db, accountId);
  if (!gate.ok) {
    console.error(`${WHAT} skipped for submission ${submissionId}: account ${accountId} cannot text (${gate.reason})`);
    await logSkipped({ db }, logSubject, REASONS.smsGate);
    return { kind: "skipped", reason: "smsGate", detail: gate.reason };
  }

  // Read-then-send, not atomic: two non-identical submissions from one
  // contact landing within the same second can both read "no recent text"
  // and both send (identical answers are already caught by the form's
  // duplicate guard). Bounded by the daily cap; a database-level guard is
  // not worth its weight at this volume — noted here so nobody hunts for it.
  const holdSince = new Date(now.getTime() - INSTANT_REPLY_THREAD_HOLD_MS);
  if (await hasRecentOutboundSms(db, accountId, input.conversationId, holdSince)) {
    await logSkipped({ db }, logSubject, REASONS.recentText);
    return { kind: "skipped", reason: "recentText" };
  }

  const capSince = new Date(now.getTime() - DAILY_CAP_WINDOW_MS).toISOString();
  if (await countInstantRepliesSince(db, accountId, capSince) >= AUTOMATION_DAILY_CAP) {
    console.error(`${WHAT} skipped for submission ${submissionId}: account ${accountId} is at its daily cap (${AUTOMATION_DAILY_CAP}/24h)`);
    await logSkipped({ db }, logSubject, REASONS.dailyCap);
    return { kind: "skipped", reason: "dailyCap" };
  }

  // The provider comes from the harness's lazy getter and from nowhere else
  // (imports.test.ts): constructed only now, after the send is decided.
  const ctx: SmsSendContext = { db, sms: lazySmsProvider() };
  // QUIET HOURS: the one inline send goes through the same seam as every
  // pass. Held → the row carries the payload, and releaseInstantReply below
  // re-runs this whole function from it when the window ends.
  const subject: HoldSubject = {
    ...logSubject,
    accountTimezone: await readAccountTimezone(db, accountId),
    payload: {
      contactId: input.contactId, conversationId: input.conversationId, phoneE164: to,
      locale: input.locale, consentWithheld: input.consentWithheld,
    } satisfies InstantReplyPayload,
  };
  let sent: SentSms | null = null;
  let unstamped = false;
  let outcome: "sent" | "held";
  try {
    outcome = await holdOrSend({ db, now, quiet: (id) => readQuietSettings(db, id) }, subject, async () => {
      sent = await sendAutomationSms(ctx, {
        accountId, contactId: input.contactId, to, from: gate.from, body,
        // The same locale that picked the body picks the opt-out
        // disclosure's language. Sending a Spanish reply that ends in
        // "Reply STOP to opt out." would undo the whole point of having a
        // bodyEs at all.
        language: input.locale,
        // Nothing retries an instant reply, so there is no attempt marker to write.
        onProviderFailure: async () => {},
      });
      // SEND-THEN-STAMP, no retry: the per-thread hold is the double-text guard;
      // the stamp is the cap's evidence — a miss undercounts by one and re-texts
      // no one.
      try {
        await stampInstantReplySent(db, submissionId);
      } catch (e) {
        unstamped = true;
        console.error(`${WHAT}: text sent but submission ${submissionId} not stamped: ${String(e)}`);
      }
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`${WHAT} failed for submission ${submissionId}: ${error}`);
    return { kind: "failed", error };
  }
  if (outcome === "held") return { kind: "held" };
  await markAutomationSmsSent(ctx, accountId, sent!, WHAT);
  return { kind: "sent", unstamped };
}

const SKIP_REASONS: Record<InstantReplySkip, string> = {
  noPhone: REASONS.noPhone, outsideRegion: REASONS.outsideRegion, consentWithheld: REASONS.consentWithheld,
  disabled: REASONS.recipeOff, smsGate: REASONS.smsGate, recentText: REASONS.recentText, dailyCap: REASONS.dailyCap,
};

/** The release: rebuild the input from the held row and run the whole
 *  function again — every check re-applies, and the held row flips to
 *  whatever this run decides. */
export const releaseInstantReply: Releaser = async (ctx, row) => {
  // `subject_key` is always `submission:<id>` for this source (built above);
  // anything else means the row was never this function's to release. A
  // silent `.replace` no-op would re-run with the WRONG submission id and,
  // worse, write the release's log under a DIFFERENT subject key than the
  // one the pass holds — leaving the original held row to be picked up and
  // re-released on every subsequent tick forever.
  const match = /^submission:(.+)$/.exec(row.subject_key);
  if (!match) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  const payload = parseInstantReplyPayload(row.payload);
  if (!payload) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  const outcome = await sendInstantReply({
    db: ctx.db, now: ctx.now, accountId: row.account_id,
    submissionId: match[1]!, ...payload,
  });
  if (outcome.kind === "skipped") {
    await logSkipped(ctx, subjectOf(row), SKIP_REASONS[outcome.reason]);
    return "skipped";
  }
  return outcome.kind;
};
