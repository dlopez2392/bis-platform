import {
  listDueBriefSubscriptions, claimBriefDay, releaseBriefDay, stampBriefOutcome, listAccountWork,
  type DueBriefSubscription,
} from "@bis/db";
import { EmailNotSent } from "@/lib/consent/email-gate";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { dailyBriefEmail } from "@/lib/email/templates/daily-brief";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { configuredOrigin } from "@/lib/email/origin";
import { briefDays, dailyBriefBand, type BriefDays } from "@/lib/brief/window";
import { isQuietDay } from "@/lib/brief/brief-gate";
import { shapeBrief } from "@/lib/brief/brief-content";
import { briefOffLinks } from "@/lib/brief/token";
import { appointments, callsAndMessages, needsAttention, type OwnerReadContext } from "@/lib/owner-line/tools/read";
import { listLeadInstantsBetween } from "@/lib/reports/weekly-metrics";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { dayKeyInZone } from "@/lib/booking/availability";
import { resolveLocale } from "@/lib/i18n/locale";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { DAILY_BRIEF_TICK_CAP, DAILY_BRIEF_BUDGET_MS } from "../caps";
import type { Pass } from "../context";

/**
 * The owner's 7 AM email (F-082, plan D4-D6): for each person who opted in on a business, what is on the calendar
 * today, what Sofía handled yesterday, what is waiting. Per subscription, in this order, each refusal counted under
 * its own name:
 *   unresolvable zone → outside 07:00-08:59 local → the person turned it on today or later → already handled for
 *   today → tick cap → tick budget → no configured APP_ORIGIN, or no signed way off → CLAIM the day → read and
 *   shape → quiet (stamp it, send nothing) → send → stamp.
 *
 * CLAIM, THEN SEND, RELEASE ON A DEFINITE FAILURE. Deliberately not the weekly report's send-then-stamp: that order
 * tolerates a duplicate when the stamp write fails, and the dispatcher may replay a tick's `now` up to 900 s old, so
 * two runs can overlap. Only the run whose conditional UPDATE won sends. The price, chosen on purpose: a function
 * killed between claim and send loses that day's brief (at most once). A send that FAILED, or a read that failed,
 * gives the claim back so the next tick in the band retries; a send that MAY have landed (the provider timed out
 * waiting) is kept, because a duplicate morning email is judged worse than a missed one.
 *
 * A MISSED BAND IS A MISSED DAY: a 10 AM "your 7 AM day" is stale and is never sent. Capped subscriptions are not
 * lost: the claim is the cursor, and the band is eight ticks wide.
 *
 * Nothing here is generated: every sentence is deterministic copy over the owner line's own reads, so the email and
 * the phone call cannot disagree about "your day". The pass writes no automation_log row (that table's `source` is
 * a CHECK-constrained list read by the client's history, and a brief to a team member is not a customer message).
 */

/** The provider's own words when it stopped waiting (email/resend.ts): the mail may still have been accepted. */
const MAY_HAVE_LANDED = /did not answer within/i;
const mayHaveLanded = (e: unknown): boolean =>
  e instanceof EmailNotSent && e.result.kind === "failed" && MAY_HAVE_LANDED.test(e.result.error);

export const dailyOwnerBriefPass: Pass = {
  key: "dailyOwnerBrief",
  async run(ctx) {
    const c = {
      sent: 0, failed: 0, skippedQuiet: 0, skippedAlreadyHandled: 0, skippedNotInBand: 0, skippedNotYet: 0,
      skippedCap: 0, skippedBudget: 0, skippedNoOrigin: 0, skippedNoWayOut: 0, unresolvableTimezone: 0,
      released: 0, unstamped: 0,
    };
    const startedAt = Date.now();
    const due = await listDueBriefSubscriptions(ctx.db);
    let attempts = 0;

    /** Give the claim back (the next tick retries). Never throws: a failed release is logged and the day stays held. */
    const release = async (row: DueBriefSubscription, day: string): Promise<void> => {
      try {
        if (await releaseBriefDay(ctx.db, { id: row.subscriptionId, day, previous: row.lastHandledDay })) c.released++;
      } catch (e) {
        console.error(`daily brief: claim on ${day} not released for subscription ${row.subscriptionId}: ${String(e)}`);
      }
    };

    for (const row of due) {
      const zone = resolveAccountZone(row.accountTimezone);
      const days = zone === null ? null : briefDays(ctx.now, zone);
      if (zone === null || days === null) {
        c.unresolvableTimezone++;
        console.error(`daily brief HELD for account ${row.accountId}: timezone ${JSON.stringify(row.accountTimezone)} is not a zone we can resolve`);
        continue;
      }
      if (!dailyBriefBand(ctx.now, zone)) { c.skippedNotInBand++; continue; }

      // It starts the morning AFTER the person turns it on (owner answer Q4); an unreadable date fails closed.
      const enabled = new Date(row.enabledAt);
      if (!Number.isFinite(enabled.getTime()) || dayKeyInZone(enabled, zone) >= days.today) { c.skippedNotYet++; continue; }
      if (row.lastHandledDay !== null && row.lastHandledDay >= days.today) { c.skippedAlreadyHandled++; continue; }

      if (attempts >= DAILY_BRIEF_TICK_CAP) { c.skippedCap++; continue; }
      if (Date.now() - startedAt >= DAILY_BRIEF_BUDGET_MS) { c.skippedBudget++; continue; }

      // A link in a mail from a vercel.app host is discarded by Gmail, and a brief with no working way off must not
      // go: refuse BEFORE claiming, so the day stays open for the tick that can send it.
      if (configuredOrigin() === null) { c.skippedNoOrigin++; continue; }
      const links = briefOffLinks({ userId: row.userId, accountId: row.accountId, now: ctx.now, origin: ctx.origin });
      if (links === null) { c.skippedNoWayOut++; continue; }
      attempts++;

      let won: boolean;
      try {
        won = await claimBriefDay(ctx.db, row.subscriptionId, days.today);
      } catch (e) {
        c.failed++;
        console.error(`daily brief: claim failed for subscription ${row.subscriptionId}: ${String(e)}`);
        continue;
      }
      if (!won) { c.skippedAlreadyHandled++; continue; }   // another run holds the day, or the person turned it off

      let built: Awaited<ReturnType<typeof compose>>;
      try {
        built = await compose(ctx.db, ctx.now, ctx.origin, row, zone, days, links.page);
      } catch (e) {
        c.failed++;
        console.error(`daily brief: compose failed for subscription ${row.subscriptionId}: ${String(e)}`);
        await release(row, days.today);
        continue;
      }

      if (built.quiet) {
        // Nothing to say: the day is handled, so the next tick does not read it all again.
        const stamp = await stampWithRetry(async () => { await stampBriefOutcome(ctx.db, { id: row.subscriptionId, day: days.today, outcome: "quiet" }); });
        if (!stamp.stamped) c.unstamped++;
        c.skippedQuiet++;
        continue;
      }

      try {
        await ctx.email.send({
          accountId: row.accountId, kind: "operator.daily_brief", to: row.email, fromName: row.brandName,
          replyTo: normalizeReplyTo(row.replyToEmail), subject: built.subject, body: built.text, html: built.html,
          language: built.locale, now: ctx.now, oneClickUnsubscribe: links.oneClick,
        });
      } catch (e) {
        c.failed++;
        if (mayHaveLanded(e)) {
          console.error(`daily brief: send to subscription ${row.subscriptionId} timed out and may have landed; NOT released: ${String(e)}`);
        } else {
          console.error(`daily brief: send failed for subscription ${row.subscriptionId}: ${String(e)}`);
          await release(row, days.today);
        }
        continue;
      }
      c.sent++;   // only after the provider answered
      const stamp = await stampWithRetry(async () => { await stampBriefOutcome(ctx.db, { id: row.subscriptionId, day: days.today, outcome: "sent" }); });
      if (!stamp.stamped) {
        // The claim already holds the day, so this cannot cause a second mail; only Preferences' "Last one" is missing.
        c.unstamped++;
        console.error(`daily brief sent but NOT stamped for subscription ${row.subscriptionId}: ${String(stamp.lastError)}`);
      }
    }
    return c;
  },
};

type Composed = { quiet: true } | { quiet: false; subject: string; text: string; html: string; locale: "en" | "es" };

/**
 * One subscription's reads and its email. Every read takes the ONE accountId of the subscription and nothing else,
 * so nothing from another business can enter this message. The owner line's three reads give the content (the
 * email and the phone call cannot disagree), the Monday report's lead read gives leads (a lead is one number
 * everywhere). The gate reads the queue's ROWS (it needs their dates) and the owner line's `needsAttention` reads
 * them again for display: two reads of the same queue, deliberately, so the shaping module stays the owner line's.
 * The person's own language first, then the account's, then English: this mail is to the person.
 */
async function compose(
  db: Parameters<typeof listAccountWork>[0], now: Date, origin: string, row: DueBriefSubscription,
  zone: string, days: BriefDays, offUrl: string,
): Promise<Composed> {
  const locale = resolveLocale(row.personLanguage, row.accountLanguage);
  const rctx: OwnerReadContext = { db, accountId: row.accountId, timezone: zone, locale, now };
  const [appts, calls, leads, work, todos] = await Promise.all([
    appointments(rctx, { range: "today" }),
    callsAndMessages(rctx, { range: "yesterday" }),
    listLeadInstantsBetween(db, row.accountId, days.yesterdayStartIso, days.todayStartIso),
    listAccountWork(db, row.accountId),
    needsAttention(rctx),
  ]);
  // A failed read is a failure, never a zero: shapeBrief throws on it, so does this gate's input.
  if (!appts.ok || !calls.ok) throw new Error(`the ${appts.ok ? "calls" : "appointments"} read failed`);
  if (isQuietDay({
    bookingsToday: appts.bookedCount, callsAnsweredYesterday: calls.count, leadsYesterday: leads.length,
    todos: work, yesterdayStartIso: days.yesterdayStartIso, tomorrowStartIso: days.tomorrowStartIso,
  })) return { quiet: true };

  const content = shapeBrief({ locale, brandName: row.brandName, zone, now, appointments: appts, calls, leads: leads.length, todos });
  const base = `${origin}/dashboard/accounts/${row.accountId}`;
  const mail = dailyBriefEmail({
    brand: emailBrandNamed(row.branding, row.brandName), content,
    links: { calendar: `${base}/calendar`, calls: `${base}/calls`, todos: `${base}/tasks` }, offUrl,
  });
  return { quiet: false, ...mail, locale };
}
