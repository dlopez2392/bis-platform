import { listDueCancelNotices, deletePendingCancelNotice } from "@bis/db";
import type { Pass } from "../context";
import {
  deliverCancelNotice, expireCancelNotice, type ComposedCancelNotice, type ExpiredReason,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/cancel-notice";

/**
 * F-048 follow-up: the business-cancel notice survives the process that
 * queued it. A cancel made on the Calendar page tells the customer from its
 * own `after()` job once the Undo window closes; when that process dies in
 * the wait, its pending row (`booking_cancel_notices`, 0100) is still here,
 * and this pass settles it on the next tick. Not a recipe: it sends only the
 * staff-typed notice the owner already asked for, through the same delivery
 * (`deliverCancelNotice`) and the same gate (`ctx.email`, the email gate
 * bound to this tick's client) as `after()`.
 *
 *   - It finds work ONLY in `booking_cancel_notices`, never by scanning
 *     `messages.status = 'queued'`: a queued row can belong to an email that
 *     already went (a failed "sent" mark), so such a scan would email the
 *     customer twice.
 *   - It reads rows due CANCEL_NOTICE_SWEEP_SLACK_MS ago or more, so an
 *     `after()` that is still alive normally settles its own row first; when
 *     the two do overlap, the claim (`claimCancelNotice`) lets exactly one
 *     send, and the loser follows rule 4 (`cancel-notice.ts`'s
 *     `onLostClaim`): it discards the queued row only when the Undo won.
 *   - Too late to tell the customer (the appointment has started, or the
 *     cancel is CANCEL_NOTICE_MAX_AGE_MS old): never sent. The notice is
 *     claimed first and its thread row marked failed (`expireCancelNotice`).
 *   - A suppressed account (D-061) is NOT filtered out of the read: the email
 *     gate refuses it for every kind (email-gate.ts step 2b), so the
 *     delivery marks the thread row failed and settles the pending row.
 *     Filtered out, its row would head the oldest-first batch for good.
 *   - A row still here CANCEL_NOTICE_ABANDON_MS after its cancel (its claim
 *     or its status read kept failing) is removed whatever happens, its
 *     thread row left as it is, and its ids logged: it can never reach the
 *     customer in time, and left in place it would crowd out newer rows.
 *   - CANCEL_NOTICE_BUDGET_MS bounds the pass: once spent, no new row is
 *     started (one already started finishes), and the rest wait, oldest
 *     first, for the next tick. cron-coupling.test.ts counts it in the sum.
 *   - The M7a billing pause: the gate stops only `automation.*` email kinds
 *     while an account is paused (email-gate.ts step 2c); this kind is
 *     staff-typed, so a paused account's notice goes, exactly as it does from
 *     `after()`. (A paused account cannot cancel in the first place:
 *     `cancelBookingAction`'s `requireAccountAccess` refuses during a pause.)
 *
 * Every @bis/db export is dereferenced inside run(), never at module scope
 * (the cron route test's bare mock throws on a dereference).
 */
export const CANCEL_NOTICE_SWEEP_SLACK_MS = 2 * 60 * 1000;
export const CANCEL_NOTICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CANCEL_NOTICE_ABANDON_MS = 48 * 60 * 60 * 1000;
/** Wall-clock time, not `ctx.now`: the last point this pass STARTS a row. About 0.5 s a row (a claim, a
 *  send, two writes), so a full batch fits; a slower tick leaves the rest for the next one. */
export const CANCEL_NOTICE_BUDGET_MS = 10_000;
/** A notice is one email and a few writes; a deploy that killed many waits leaves the rest, oldest first,
 *  to the next tick. Kept small so this pass can never crowd the tick's 300 s ceiling. */
export const CANCEL_NOTICE_SWEEP_BATCH = 25;

export const cancelNoticesPass: Pass = {
  key: "cancelNotices",
  async run(ctx) {
    const c = { sent: 0, failed: 0, expired: 0, undone: 0, elsewhere: 0, unsettled: 0, abandoned: 0, deferred: 0 };
    const now = ctx.now.getTime();
    const due = await listDueCancelNotices(
      ctx.db, new Date(now - CANCEL_NOTICE_SWEEP_SLACK_MS).toISOString(), CANCEL_NOTICE_SWEEP_BATCH,
    );
    const startedAt = Date.now();
    for (const [i, row] of due.entries()) {
      if (Date.now() - startedAt >= CANCEL_NOTICE_BUDGET_MS) {
        c.deferred = due.length - i;
        console.error(`cancel notices: budget spent, ${c.deferred} row(s) left for the next tick`);
        break;
      }
      if (!(Date.parse(row.createdAt) > now - CANCEL_NOTICE_ABANDON_MS)) {
        try {
          await deletePendingCancelNotice(ctx.db, row.accountId, row.bookingId, row.version);
          c.abandoned++;
          console.error(`cancel notice for booking ${row.bookingId} (account ${row.accountId}), message ${row.messageId}: never settled within 48 hours, pending row removed; its thread row is left as it is`);
        } catch (e) {
          c.unsettled++;
          console.error(`cancel notice for booking ${row.bookingId} (account ${row.accountId}): past 48 hours and its pending row not removed: ${String(e)}`);
        }
        continue;
      }
      const notice = {
        accountId: row.accountId, bookingId: row.bookingId, version: row.version, userId: row.userId,
        messageId: row.messageId, email: row.email as ComposedCancelNotice,
      };
      const startsAt = row.startsAt === null ? Number.NaN : Date.parse(row.startsAt);
      const late: ExpiredReason | null = !(startsAt > now) ? "started"
        : !(Date.parse(row.createdAt) > now - CANCEL_NOTICE_MAX_AGE_MS) ? "too_old"
        : null;
      // Both never throw; a row that fails is that row's outcome, never the tick's.
      if (late) c[await expireCancelNotice(notice, { db: ctx.db }, late)]++;
      else c[await deliverCancelNotice(notice, { db: ctx.db, send: (req) => ctx.email.send(req) })]++;
    }
    return c;
  },
};
