import {
  recordAutomationLog, getAutomationLogEntry,
  type AutomationLogRow, type AutomationLogSource, type AutomationLogChannel, type AutomationLogWrite,
} from "@bis/db";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { inQuietWindow, quietWindowEnd, formatInstantClock } from "./quiet-hours";
import type { PassContext } from "./context";

/**
 * The one place a customer-facing send meets the quiet-hours window and the
 * automation log (spec §1, §2, amendments 1 and 4).
 *
 *   holdOrSend(ctx, subject, send)
 *     inside the window → write (or re-write) the held row, held_until =
 *                         the window's end, return "held". The pass does NOT
 *                         stamp; the release pass brings the subject back.
 *     otherwise         → send(); write `sent`; return "sent".
 *                         send() throwing → write `failed`, rethrow.
 *     the exemption     → a `deadline` (a reminder's starts_at) at or before
 *                         the window's end sends now: the 6:45 text for the
 *                         7:30 job.
 *
 * The `sent`/`failed`/`skipped` log writes are an isolated leg (`record`):
 * losing one loses a history line, not a send, so a failure is one
 * console.error and nothing more. The `held` write is NOT isolated — it is
 * the enqueue. If it is lost, `holdOrSend` still returns "held", the pass
 * does not stamp, and the row simply vanishes: no error, no retry, and if
 * the appointment's own 75-minute reminder band closes while the account is
 * still in its quiet window, nothing ever sends it. So the held write is
 * made DIRECTLY (not through `record`) and a failure REJECTS the call, so
 * the pass counts `failed` and the tick's own retry-next-time behaviour
 * (the row is still unstamped) is what saves it — true of the five CRON
 * passes. The one exception: the inline instant reply (`instant-reply.ts`,
 * fired once per form submission — no due-list, no tick) has no next tick to
 * retry it. There, the enqueue failure surfaces as this call's own rejection,
 * which `sendInstantReply` turns into a `{ kind: "failed" }` outcome, and its
 * caller (`enrich.ts`) records that into the submission's `processing_error`
 * instead — the operator's "somebody was not told about this lead" signal,
 * since a lost text would otherwise be invisible past one console line. The
 * settings READ has the same shape for the same reason: a rejected read
 * rejects the call.
 */
export type HoldContext = Pick<PassContext, "db" | "now" | "quiet">;

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
  /** The latest instant this send is still useful. At or before the window's end → send now. */
  deadline?: Date | null;
};

/** Client-readable, every one of them: a business owner reads these on the Activity page. */
export const REASONS = {
  quietHours: (endsAt: Date, zone: string) => `Held until ${formatInstantClock(endsAt, zone)} — quiet hours`,
  noEmail: "No email address on file",
  noPhone: "No phone number we can text",
  smsGate: "Texting isn't set up for this company yet",
  dailyCap: "Daily limit reached",
  failed: "Couldn't be delivered",
  appointmentStarted: "Appointment already started",
  noLongerDue: "No longer due",
  recipeOff: "This automation was turned off",
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
  outsideRegion: "Number is outside the US, Canada or Mexico",
  consentWithheld: "They didn't agree to texts",
  robocall: "Screened as a robocall",
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

export async function holdOrSend(
  ctx: HoldContext, s: HoldSubject, send: () => Promise<void>,
): Promise<"sent" | "held"> {
  const zone = resolveAccountZone(s.accountTimezone);
  let quietEnd: Date | null = null;
  if (zone === null) {
    console.error(
      `quiet hours: account ${s.accountId}'s timezone ${JSON.stringify(s.accountTimezone)} cannot be resolved — `
      + `sending ${s.source} ${s.subjectKey} without a window; fix the account's timezone`,
    );
  } else {
    const settings = await ctx.quiet(s.accountId);
    if (inQuietWindow(ctx.now, zone, settings)) quietEnd = quietWindowEnd(ctx.now, zone, settings);
  }

  if (quietEnd !== null && !(s.deadline && s.deadline.getTime() <= quietEnd.getTime())) {
    // Re-holding under the SAME window must not re-stamp `occurred_at` (a
    // subject seen on every 15-minute tick while quiet hours stay in
    // effect would otherwise re-sort to the top of the history every time).
    // A DIFFERENT held_until — the window changed — still writes.
    const existing = await getAutomationLogEntry(ctx.db, s.accountId, s.source, s.subjectKey);
    const unchanged = existing?.status === "held"
      && existing.held_until !== null
      && new Date(existing.held_until).getTime() === quietEnd.getTime();
    if (!unchanged) {
      try {
        await recordAutomationLog(ctx.db, {
          ...writeOf(s), status: "held", heldUntil: quietEnd.toISOString(), reason: REASONS.quietHours(quietEnd, zone!),
        });
      } catch (e) {
        console.error(
          `quiet hours: could not enqueue ${s.source} ${s.subjectKey} for account ${s.accountId} — `
          + `the row stays unstamped and is due again next tick: ${String(e)}`,
        );
        throw e;
      }
    }
    return "held";
  }

  try {
    await send();
  } catch (e) {
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
