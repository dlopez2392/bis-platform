import {
  recordAutomationLog, getAutomationLogEntry,
  type AutomationLogRow, type AutomationLogSource, type AutomationLogChannel, type AutomationLogWrite,
} from "@bis/db";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { SMS_KINDS, type AutomationSmsKind } from "@/lib/consent/classes";
import { nextOpening, expiresBeforeOpening, hoursZone, type HoursRule } from "@/lib/consent/hours";
import { formatInstantClock } from "./quiet-hours";
import { SmsDeferred, SmsBlocked, LEDGER_RETRY_MS, type AutomationBlockReason } from "./send-sms";
import { EmailNotSent, type EmailBlockReason } from "@/lib/consent/email-gate";
import type { PassContext } from "./context";
import { closureVerdict, CLOSURE_REASONS, type ClosureState } from "./closures";
import { pauseHold, pauseHoldInForce } from "./pause-hold";
import { billingEnforced } from "@/lib/billing/enforce";
import { m } from "@/lib/messages";

/**
 * The one place an automated customer send meets its sending hours and the
 * automation log (automation engine part C; consent chain spec §4.1 item 4).
 *
 *   holdOrSend(ctx, subject, send)
 *     a closure covers  → S-47d (spec 5.5.2), FIRST and only for a subject with
 *     the appointment     `appointmentAt` (the seven booking recipes): held until
 *                         the closure's window ends or the deadline, skipped once
 *                         the deadline has passed, held LEDGER_RETRY_MS when the
 *                         status cannot be read (closures.ts closureVerdict).
 *     a pause hold in  → M7a PR-4 (owner answer I6, plan G7a), switch on only:
 *     force               the subject's own log row is `held` with the pause
 *                         reason and its held_until is still ahead → "held",
 *                         on that one read, without asking the gate. Runs
 *                         after the closure and the hours, before send().
 *     outside the hours → write (or re-write) the held row, held_until = the
 *                         instant they open, return "held". The pass does NOT
 *                         stamp; the release pass brings the subject back.
 *     past its deadline → a subject whose deadline falls at or before that
 *                         opening is logged skipped ("Not sent: quiet hours
 *                         ran past the appointment", choice 21) and never
 *                         sent: a reminder after the appointment is worse
 *                         than none. The old "a deadline sends now, inside
 *                         the window" exemption is gone (decision 4).
 *     otherwise         → send(); write `sent`; return "sent".
 *                         send() throwing SmsDeferred → held, as above;
 *                         SmsBlocked or EmailNotSent `billing_paused` (the
 *                         account is paused, either gate) → HELD, never
 *                         dropped: until the next whole UTC hour or the
 *                         subject's pause deadline, whichever is first;
 *                         skipped ("too late, the account was paused") once
 *                         that deadline has passed (pause-hold.ts);
 *                         SmsBlocked → skipped with the gate's reason;
 *                         EmailNotSent → held, skipped or failed by the email
 *                         gate's answer (consent PR-3);
 *                         anything else → write `failed`, rethrow.
 *
 * THE HOURS ARE FIXED and come from the gate's own module (lib/consent/
 * hours.ts): an SMS subject uses its kind's rule from the registry
 * (automated 08:00-21:00; marketing 09:00-21:00, Sunday from noon), and an
 * EMAIL subject the automated rule (choice 31). Nothing reads the old
 * per-account quiet-hours settings. The hours are judged at the SEND's
 * instant (`sendInstant`: the context's clock, F-196), never the tick's now,
 * which under fan-out can be minutes old. The gate checks the hours again for
 * SMS on the same clock (sendAutomationSms), read a moment later, so it can
 * only be stricter; if it ever is, its SmsDeferred lands here as a hold all
 * the same. Every window (deadlines, closures, pause holds) still reads now.
 *
 * The `sent`/`failed`/`skipped` log writes are an isolated leg (`record`):
 * losing one loses a history line, not a send. The `held` write is NOT
 * isolated: it is the enqueue. If it is lost, the row simply vanishes, so it
 * is made DIRECTLY and a failure REJECTS the call; the pass counts `failed`
 * and its own retry-next-tick behaviour (the row is still unstamped) saves
 * it. The inline instant reply has no next tick: there the rejection becomes
 * `{ kind: "failed" }`, which enrich.ts records into the submission's
 * `processing_error`.
 */
export type HoldContext = Pick<PassContext, "db" | "now"> & Partial<Pick<PassContext, "closures" | "clock">>;

/** F-196: the instant the sending hours are judged at: the send's own clock
 *  when the context has one (every pass's does, harness.ts), else `now`
 *  (the inline callers, whose now is the moment). Never used for a window. */
export function sendInstant(ctx: Pick<PassContext, "now" | "clock">): Date {
  return ctx.clock ? ctx.clock() : ctx.now;
}

export type LogSubject = {
  accountId: string;
  source: AutomationLogSource;
  /** Widened to the db's own channel set (not just "sms" | "email") so
   *  `subjectOf` can round-trip an `ai` row (voice) without coercing it —
   *  every PASS still only ever sends sms or email, but a release reads
   *  whatever channel the original send recorded. */
  channel: AutomationLogChannel;
  subjectKey: string;
  contactId: string | null;
  /** What a release needs that the subject row cannot re-derive. */
  payload?: Record<string, unknown>;
};

export type HoldSubject = LogSubject & {
  accountTimezone: string | null;
  /** The latest instant this send is still useful. At or before the hours'
   *  opening → not sent at all (choice 21). */
  deadline?: Date | null;
  /** REQUIRED on the sms channel: the kind decides the hours (a marketing
   *  text waits for 09:00, and for noon on Sunday). holdOrSend throws
   *  without it rather than guess the weaker rule. */
  smsKind?: AutomationSmsKind;
  /** S-47d (spec 5.5.2): the appointment this send is about, set ONLY by the seven booking recipes from the
   *  due row's `starts_at`. With it, a closure that covers the appointment holds or skips the send before
   *  the sending hours are read. Absent (every other sender) changes nothing and reads no status. */
  appointmentAt?: Date;
  /** S-47d (SD20): the due row's own Keep (`closure_kept_at` is not null): the owner said this appointment
   *  is happening, so no closure holds it, however old it is. Read only with `appointmentAt`. */
  kept?: boolean;
  /** S-47d, owner rulings D13a and D13b (2026-10-24): set by the AUTOMATIC follow-up alone. Once a closure
   *  that covered the appointment has ended, on its own or by a switch to Open or Running late (the history
   *  closures.ts rebuilds from the switch's change log), the send is skipped rather than sent, unless the
   *  appointment was kept. Every other recipe leaves it unset: the review request, referral ask and no-show
   *  nudge follow a staff mark that is proof of what happened, and an ended closure lets them send (SD6), as it
   *  does the before-appointment recipes. Read only with `appointmentAt`. */
  skipIfWasClosed?: true;
  /** I6 (M7a PR-4, plan G7a): when a pause-held subject is no longer timely; a pause hold never runs past it,
   *  and once it has passed the send is skipped, not held again. Falls back to `deadline`. Set by the recipes
   *  whose list carries a max age (review request, referral ask, no-show nudge, quote follow-up). */
  pauseDeadline?: Date | null;
};

/** A subject that texts. Its `smsKind` is the ONE literal that decides both
 *  the hours holdOrSend reads and the kind the gate is asked for: a sender
 *  passes `kind: subject.smsKind`, never a second literal that could
 *  disagree (the Task 9 review, minor 2). */
export type SmsHoldSubject = HoldSubject & { smsKind: AutomationSmsKind };

/** Client-readable, every one of them: a business owner reads these on the Activity page. */
export const REASONS = {
  quietHours: (endsAt: Date, zone: string) => `Held until ${formatInstantClock(endsAt, zone)} — quiet hours`,
  /** Choice 21: the hours opened only after the thing this send was for. */
  windowAfterDeadline: "Not sent: quiet hours ran past the appointment",
  /** Review R2-I4: the consent state could not be read, so the send waits
   *  LEDGER_RETRY_MS and the release pass tries again. */
  ledgerRetry: m["automations.reason.ledgerRetry"],
  /** S-47d (spec 5.5.2): heldClosedToday, heldStorm, heldClosedDay (a closure covers the appointment),
   *  heldClosureUnknown (the status could not be read) and skippedClosed (the deadline passed, or, D13, an
   *  after-appointment send for a closure that has ended). Written once, in closures.ts (review M3). */
  ...CLOSURE_REASONS,
  /** The email gate's two outages (consent PR-3): each a LEDGER_RETRY_MS
   *  re-hold, never a skip, so the email goes once the outage ends. */
  emailLedgerRetry: m["automations.reason.emailLedgerRetry"],
  emailSetupRetry: m["automations.reason.emailSetupRetry"],
  /** The re-hold age cap (orchestrator, 2026-09-26; RETRY_MAX_AGE_MS). */
  tooLongAfterCall: m["automations.reason.tooLongAfterCall"],
  tooLongAfterWriteIn: m["automations.reason.tooLongAfterWriteIn"],
  /** M7a PR-4 (owner answer I6): the account is paused for non-payment, so the
   *  send waits (pause-hold.ts); and the one it becomes once the subject's
   *  pause deadline has passed. */
  heldBillingPaused: m["automations.reason.heldBillingPaused"],
  skippedBillingPaused: m["automations.reason.skippedBillingPaused"],
  /** The pause's refusal for a send that is not held (the document request): no deadline passed, so never
   *  the "too late" line above. */
  billingPaused: m["automations.reason.billingPaused"],
  /** The consent gate's refusals (lib/consent/gate.ts), in the words the
   *  client reads on the Activity page. */
  textsStopped: m["automations.reason.textsStopped"],
  textsHeld: m["automations.reason.textsHeld"],
  numberUnconfirmed: m["automations.reason.numberUnconfirmed"],
  noEmail: "No email address on file",
  noPhone: "No phone number we can text",
  smsGate: "Texting isn't set up for this company yet",
  dailyCap: "Daily limit reached",
  failed: "Couldn't be delivered",
  appointmentStarted: "Appointment already started",
  noLongerDue: "No longer due",
  recipeOff: "This automation was turned off",
  /** D-061: `accounts.outbound_suppressed` (0032) — a demo account, or any
   *  account the agency has otherwise marked not real; not "pre-go-live"
   *  (go-live's own migration, 0063, never reads or writes this column).
   *  Only ever logged from a RELEASE, the same way `recipeOff` is: the
   *  inline send itself returns before this reason could be written. */
  accountSuppressed: m["automations.reason.accountSuppressed"],
  timezone: "The company's time zone isn't set",
  calendarOff: "The booking page is switched off",
  recentText: "A text already went to this person today",
  /** A RELEASED row's own SMS-cooldown branch (a failed attempt less than 24h
   *  ago). Deliberately distinct from `recentText`, which reads oddly for a
   *  retry after a FAILURE rather than an already-sent text today. Used only
   *  on release (item 3, part-C cleanup): a normal tick leaves this branch
   *  silent, unlogged, because the row is simply due again next tick — but a
   *  row released from the HELD queue has nowhere to go back to except the
   *  same past `held_until`, and would otherwise be re-examined, re-found
   *  "skipped" and re-left `held` forever, parking it at the head of the
   *  queue and starving every newer hold behind it. */
  smsCooldown: "Waiting before trying this text again",
  /** The confirmation ask, released after a long hold into the window in
   *  which the email reminder is already eligible (24h15m out,
   *  REMINDER_WINDOW_END_MS). Sending "can you confirm?" in the same quarter
   *  hour as "here's your reminder" is ONE TEXT AND ONE EMAIL landing
   *  together, asking the customer for the same thing twice. */
  tooCloseToAppointment: "Too close to the appointment to ask",
  /** The referral ask, released while the review request is still owed. The
   *  row is written `skipped` rather than left untouched: an untouched
   *  released row keeps its past `held_until` and parks the head of the
   *  queue. The normal pass re-discovers the unstamped booking the next
   *  morning and moves this same row back to `held` or `sent` in place. */
  reviewFirst: "Waiting for the review request to go first",
  /** A reactivation or a quote follow-up released after the customer had
   *  already been in touch. Sending it anyway would talk straight over a live
   *  conversation — the one failure mode these two recipes cannot survive. */
  heardBack: "They've been in touch since",
  /** A quote follow-up released after the operator deleted or replaced the
   *  pipeline stage this recipe watches. A normal tick can never produce
   *  this — the due-list filters on the stage, so a vanished one yields no
   *  row and there is no subject to write against — but a HELD row's stage
   *  can disappear during the hold, and that row must leave the queue with a
   *  reason rather than sit in it. The operator-facing half of the same fact
   *  lives on the Automations card, which can see the account's stages. */
  stageGone: "The stage this automation watches is gone",
  /** A MARKETING email — a reactivation, or a referral ask on the email
   *  channel (B21) — whose account has no postal address (blank after
   *  `.trim()`, 0048). Both are commercial email, which under CAN-SPAM (the
   *  orchestrator's reading, not a lawyer's) must carry the sender's
   *  physical address, so it is skipped rather than sent without one
   *  (decision A, 2026-09-22). The save refuses to turn either recipe on
   *  without it; this is the address cleared on the Branding page since. */
  noMailingAddress: "The company's mailing address isn't set",
  /** A marketing email whose account has no reply-to. The footer's opt-out
   *  is "reply and let us know", and with no reply-to (and no `from_email`) a
   *  reply lands in the agency's `EMAIL_FROM` mailbox rather than the
   *  business's — an opt-out that reaches nobody who can act on it. Skipped,
   *  like the missing address, for the same decision. */
  noReplyTo: "The company has no reply-to address",
  /** An automated email to a customer whose email is stopped in the ledger
   *  (consent PR-3): they unsubscribed, staff recorded their request, or
   *  0049's old "No marketing emails" was folded in. The email gate refuses
   *  it for every automated kind (decision 7), and this is the line the
   *  client reads on the Activity page. */
  optedOutEmail: "They asked not to get these emails",
  /** D-016 (0062): the email gate's new refusal — a hard bounce or a
   *  complaint on this address, a fact the PROVIDER reports, never
   *  something the customer asked for, so it reads differently from
   *  optedOutEmail above on the Activity page. */
  suppressedEmail: "This address bounced or was marked as spam",
  outsideRegion: "Number is outside the US, Canada or Mexico",
  consentWithheld: "They didn't agree to texts",
  robocall: "Screened as a robocall",
  /** finish-call.ts's own automation-log row for an `abandoned` outcome
   *  (D-065): the caller spoke but left with no booking, lead or message, so
   *  this must not count as "handled" alongside `robocall` above — both are
   *  `skipped`, never `sent`. Matches the dashboard calls chart's own
   *  "N caller(s) hung up before Sofía could help" line
   *  (weekly-metrics.ts's `ABANDONED_OUTCOME`) in substance, worded for a
   *  single call rather than a count. */
  callerHungUp: "The caller hung up before anyone could help",
  /** handoff-result/route.ts's own "nobody picked up" branch (D-065 follow-
   *  up): `finishCall` already wrote this call's automation_log row `sent`
   *  the moment the caller ASKED for a person (`wasServed`'s optimistic
   *  bet, made before the dial was even attempted) — but the dial rang out,
   *  so the row has to say so, same as a true hang-up would have, had the
   *  caller never asked at all. */
  transferNoAnswer: "Nobody answered the transfer",
} as const;

async function record(db: PassContext["db"], w: AutomationLogWrite): Promise<void> {
  try {
    await recordAutomationLog(db, w);
  } catch (e) {
    console.error(`automation log write failed (${w.status}) for ${w.source} ${w.subjectKey}: ${String(e)}`);
  }
}

/**
 * The LogSubject fields only — never the HoldSubject's `accountTimezone` or
 * `deadline`, which are inputs to the DECISION, not the log row. Spreading
 * the whole HoldSubject would carry a `Date` into the row's jsonb and add
 * keys `recordAutomationLog` was never asked to write.
 */
function writeOf(s: LogSubject): {
  accountId: string; source: AutomationLogSource; channel: AutomationLogChannel;
  subjectKey: string; contactId: string | null; payload?: Record<string, unknown>;
} {
  return {
    accountId: s.accountId, source: s.source, channel: s.channel,
    subjectKey: s.subjectKey, contactId: s.contactId,
    ...(s.payload ? { payload: s.payload } : {}),
  };
}

export async function logSkipped(ctx: Pick<PassContext, "db">, s: LogSubject, reason: string): Promise<void> {
  await record(ctx.db, { ...writeOf(s), status: "skipped", reason });
}

/** Every refusal the gate can hand an automation, as the Activity page says it. */
export const BLOCK_REASONS: Record<AutomationBlockReason, string> = {
  no_number: REASONS.noPhone,
  a2p_not_approved: REASONS.smsGate,
  no_live_number: REASONS.smsGate,
  stopped: REASONS.textsStopped,
  held: REASONS.textsHeld,
  unconfirmed_number: REASONS.numberUnconfirmed,
  window_after_deadline: REASONS.windowAfterDeadline,
  suppressed_account: REASONS.accountSuppressed,
  // holdOrSend HOLDS this one before it could be read here (G7a); the words are
  // for a path that logs a refusal itself (the document request).
  billing_paused: REASONS.billingPaused,
};

/** Every refusal the EMAIL gate can hand an automation, as the Activity page
 *  says it. Its two outages are re-holds, not refusals (holdOrSend). */
export const EMAIL_BLOCK_REASONS: Record<Exclude<EmailBlockReason, "ledger_unavailable" | "unsubscribe_unavailable">, string> = {
  no_address: REASONS.noEmail,
  stopped: REASONS.optedOutEmail,
  held: REASONS.optedOutEmail,
  suppressed: REASONS.suppressedEmail,
  window_after_deadline: REASONS.windowAfterDeadline,
  suppressed_account: REASONS.accountSuppressed,
  // As BLOCK_REASONS: holdOrSend holds it first (G7a).
  billing_paused: REASONS.billingPaused,
};

function hoursRuleOf(s: HoldSubject): HoursRule {
  if (s.channel !== "sms") return "automated";
  if (!s.smsKind) throw new Error(`holdOrSend: sms subject ${s.source} ${s.subjectKey} has no smsKind`);
  return SMS_KINDS[s.smsKind].hours;
}

/**
 * The held write, shared with the missed-call text-back (lib/voice/
 * textback.ts), which is not a pass but holds through the same queue.
 * Re-holding under the SAME held_until does not re-stamp `occurred_at` (a
 * subject seen on every 15-minute tick overnight would otherwise re-sort to
 * the top of the history every time); a DIFFERENT held_until still writes.
 * REJECTS on a failed write: this is the enqueue.
 */
export async function writeHeld(
  ctx: Pick<PassContext, "db">, s: LogSubject, until: Date, zone: string,
  reason: string = REASONS.quietHours(until, zone),
): Promise<void> {
  const existing = await getAutomationLogEntry(ctx.db, s.accountId, s.source, s.subjectKey);
  const unchanged = existing?.status === "held"
    && existing.held_until !== null
    && new Date(existing.held_until).getTime() === until.getTime();
  if (unchanged) return;
  try {
    await recordAutomationLog(ctx.db, {
      ...writeOf(s), status: "held", heldUntil: until.toISOString(), reason,
    });
  } catch (e) {
    console.error(
      `sending hours: could not enqueue ${s.source} ${s.subjectKey} for account ${s.accountId} — `
      + `the row stays unstamped and is due again next tick: ${String(e)}`,
    );
    throw e;
  }
}

export async function holdOrSend(
  ctx: HoldContext, s: HoldSubject, send: () => Promise<void>,
): Promise<"sent" | "held" | "skipped"> {
  if (resolveAccountZone(s.accountTimezone) === null) {
    console.error(
      `sending hours: account ${s.accountId}'s timezone ${JSON.stringify(s.accountTimezone)} cannot be resolved — `
      + `${s.source} ${s.subjectKey} keeps the fallback zone's hours; fix the account's timezone`,
    );
  }
  const zone = hoursZone(s.accountTimezone);
  if (s.appointmentAt) {
    // S-47d (spec 5.5.2): a closure that covers this appointment holds it, before the sending-hours check.
    // The SUBJECT's own account, never another: the loader is per account (fix-round item 6).
    const state: ClosureState = ctx.closures ? await ctx.closures(s.accountId) : { ok: false };
    const v = closureVerdict(state, {
      appointmentAt: s.appointmentAt, kept: s.kept === true, deadline: s.deadline,
      skipIfWasClosed: s.skipIfWasClosed === true,
    }, ctx.now);
    if (v.kind === "skipped") { await logSkipped(ctx, s, v.reason); return "skipped"; }
    if (v.kind === "held") { await writeHeld(ctx, s, v.until, zone, v.reason); return "held"; }
  }
  // F-196: the hours at the SEND's instant, not the tick's now: under
  // fan-out a pass can start minutes after the tick (context.ts `clock`).
  const opening = nextOpening(hoursRuleOf(s), sendInstant(ctx), zone);
  if (expiresBeforeOpening(opening, s.deadline)) {
    await logSkipped(ctx, s, REASONS.windowAfterDeadline);
    return "skipped";
  }
  if (opening) {
    await writeHeld(ctx, s, opening, zone);
    return "held";
  }

  // G7a (re-review I1): a pause hold still in force answers on its own log
  // row, so a held subject seen on every tick costs one log read and no gate
  // read. Only the pause reason short-circuits; any other hold goes on as
  // today. Switch off: no read at all.
  if (billingEnforced()) {
    const existing = await getAutomationLogEntry(ctx.db, s.accountId, s.source, s.subjectKey);
    if (pauseHoldInForce(existing, ctx.now)) return "held";
  }

  try {
    await send();
  } catch (e) {
    // I6 / G7a: a paused account's automation is held, not dropped.
    const pausedRefusal = (e instanceof SmsBlocked && e.reason === "billing_paused")
      || (e instanceof EmailNotSent && e.result.kind === "blocked" && e.result.reason === "billing_paused");
    if (pausedRefusal) {
      const v = pauseHold(s.pauseDeadline ?? s.deadline, ctx.now);
      if (v.kind === "skipped") { await logSkipped(ctx, s, REASONS.skippedBillingPaused); return "skipped"; }
      await writeHeld(ctx, s, v.until, zone, REASONS.heldBillingPaused);
      return "held";
    }
    if (e instanceof SmsDeferred) {
      await writeHeld(ctx, s, e.until, zone, e.why === "ledger_unavailable" ? REASONS.ledgerRetry : undefined);
      return "held";
    }
    if (e instanceof SmsBlocked) {
      await logSkipped(ctx, s, BLOCK_REASONS[e.reason]);
      return "skipped";
    }
    if (e instanceof EmailNotSent) {
      const r = e.result;
      if (r.kind === "deferred") {
        await writeHeld(ctx, s, r.until, zone);
        return "held";
      }
      if (r.kind === "blocked") {
        if (r.reason === "ledger_unavailable" || r.reason === "unsubscribe_unavailable") {
          await writeHeld(ctx, s, new Date(ctx.now.getTime() + LEDGER_RETRY_MS), zone,
            r.reason === "ledger_unavailable" ? REASONS.emailLedgerRetry : REASONS.emailSetupRetry);
          return "held";
        }
        await logSkipped(ctx, s, EMAIL_BLOCK_REASONS[r.reason]);
        return "skipped";
      }
      // failed: today's failure path, below.
    }
    await record(ctx.db, { ...writeOf(s), status: "failed", reason: REASONS.failed });
    throw e;
  }
  await record(ctx.db, { ...writeOf(s), status: "sent", reason: "" });
  return "sent";
}

export type ReleaseVerdict = "sent" | "held" | "skipped" | "failed";
export type Releaser = (ctx: PassContext, row: AutomationLogRow) => Promise<ReleaseVerdict>;

/** A held row, back into the shape the pass writes with — so the release re-writes the SAME row. */
export function subjectOf(row: AutomationLogRow): LogSubject {
  return {
    accountId: row.account_id, source: row.source, channel: row.channel,
    subjectKey: row.subject_key, contactId: row.contact_id, payload: row.payload,
  };
}

/** What a one-row process run amounted to. */
export function verdict(c: { sent: number; held: number; failed: number }): ReleaseVerdict {
  if (c.sent > 0) return "sent";
  if (c.held > 0) return "held";
  if (c.failed > 0) return "failed";
  return "skipped";
}
