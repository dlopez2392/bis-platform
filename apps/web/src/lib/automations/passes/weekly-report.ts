import { listAccountsDueWeeklyReport, stampWeeklyReportSent, getVoiceProfile, recordAutomationLog } from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { weeklyReportEmail, weeklyReportSubject } from "@/lib/email/templates/weekly-report";
import { weeklyMetrics } from "@/lib/reports/weekly-metrics";
import { inMondayBand, lastWeekMonday, weekWindow } from "@/lib/reports/weekly-window";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { WEEKLY_REPORT_TICK_CAP, WEEKLY_REPORT_BUDGET_MS } from "../caps";
import type { Pass } from "../context";

/**
 * The client's Monday-morning email: how last week went, in the account's own
 * zone. Per account, in this order, each refusal counted under its own name:
 *   unresolvable zone → outside the Monday 08:00-11:00 local band → already
 *   stamped for the week that just ended → tick cap → tick budget →
 *   compute both weeks' numbers → send, ONE message PER RECIPIENT → stamp
 *   once at least one recipient received it.
 *
 * `listAccountsDueWeeklyReport` already filters server-side to accounts with
 * at least one `report_emails` entry, so an unconfigured account is never a
 * row here and never a failure.
 *
 * A MISSED BAND IS A MISSED WEEK (spec, "Recorded consequence"): the band is
 * three hours wide and the cron ticks every 15 minutes, so an outage spanning
 * the whole band means this week's report never sends and is not retried
 * later — sending Thursday's "here's how last week went" would be worse than
 * not sending. Same trade the booking milestone already made for reminders.
 */
export const weeklyClientReportPass: Pass = {
  key: "weeklyClientReport",
  async run(ctx) {
    const c = {
      sent: 0, failed: 0, skippedNotMonday: 0, skippedAlreadySent: 0,
      skippedCap: 0, skippedBudget: 0, unresolvableTimezone: 0, unstamped: 0,
    };
    // D-067: the real cursor across the Monday band's twelve ticks is
    // `row.lastSentWeek`, checked below BEFORE either limit — an account
    // already stamped for this week is skipped for free, so the cap/budget
    // attempts this tick spends always land on accounts the LAST tick had
    // not reached yet, never a repeat of the same slice. What
    // `listAccountsDueWeeklyReport`'s `created_at` ordering adds on top is
    // narrower: it makes WHICH not-yet-stamped accounts get this tick's
    // limited attempts deterministic, rather than left to an unstable scan
    // order that could favour a different subset by accident tick to tick.
    const due = await listAccountsDueWeeklyReport(ctx.db);
    let attemptsThisTick = 0;
    const startedAt = Date.now();

    for (const row of due) {
      const zone = resolveAccountZone(row.accountTimezone);
      if (zone === null) {
        c.unresolvableTimezone++;
        console.error(
          `weekly report HELD for account ${row.accountId}: timezone `
          + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve — fix the account's timezone`,
        );
        continue;
      }

      if (!inMondayBand(ctx.now, zone)) {
        c.skippedNotMonday++;
        continue;
      }

      // The Monday of the week that just ended — both the window key and
      // what gets stamped on success.
      const monday = lastWeekMonday(ctx.now, zone);
      if (monday === row.lastSentWeek) {
        c.skippedAlreadySent++;
        continue;
      }

      // CAP (caps.ts, D-067): this pass's OWN limit, not the shared recipe
      // burst guard — one attempt per ACCOUNT, counted before the
      // compute/send below, win or lose.
      if (attemptsThisTick >= WEEKLY_REPORT_TICK_CAP) {
        c.skippedCap++;
        continue;
      }
      // BUDGET (D-067): checked after the (free) cap compare, so a tick
      // already at its cap never pays for a clock read. Measured BEFORE
      // this account's compute-and-send starts, not mid-send — there is no
      // measured worst case for an email provider round trip the way the
      // usage report has one for Stripe's SDK, so this account may run
      // somewhat past the budget rather than guess at a margin with no
      // evidence behind it. Left for the next tick, same as a capped one.
      if (Date.now() - startedAt >= WEEKLY_REPORT_BUDGET_MS) {
        c.skippedBudget++;
        continue;
      }
      attemptsThisTick++;

      try {
        // WINDOW: the week that just ended, plus the week before it for the
        // delta. The prior Monday is derived by re-running `lastWeekMonday`
        // on the CURRENT window's own local-midnight instant rather than a
        // hand-rolled day-shift — the same zone-aware, DST-safe machinery
        // `weekWindow` itself relies on, just asked "and the Monday before
        // THAT one?" (weekly-window.ts exports no such helper directly, and
        // this task does not touch that file).
        const window = weekWindow(monday, zone);
        const priorMonday = lastWeekMonday(new Date(window.fromIso), zone);
        const priorWindow = weekWindow(priorMonday, zone);
        // FABRICATED-DELTA GUARD: an account younger than the prior window
        // has no honest "week before" to compare against. Parsed to epoch ms
        // on both sides — `priorWindow.fromIso` is `.toISOString()`'s
        // `.000Z`-suffixed form, while `row.createdAt` comes back from
        // Postgres `+00:00`-suffixed; a plain string compare misorders them
        // (see the account dashboard page's own `window7FromMs` comment).
        const priorValid = Date.parse(priorWindow.fromIso) >= Date.parse(row.createdAt);

        const [now, prior, profile] = await Promise.all([
          weeklyMetrics(ctx.db, row.accountId, window, row.hasSite),
          priorValid ? weeklyMetrics(ctx.db, row.accountId, priorWindow, row.hasSite) : Promise.resolve(null),
          getVoiceProfile(ctx.db, row.accountId),
        ]);

        const brand = emailBrandNamed(row.branding, row.brandName);
        const { html, text } = weeklyReportEmail({
          brand, now, prior,
          dashboardUrl: `${ctx.origin}/dashboard/accounts/${row.accountId}/dashboard`,
          // A null voice profile means BOTH flags are false — never claim a
          // feature this account does not have.
          reassurance: {
            receptionist: profile?.enabled ?? false,
            textBack: profile?.textback_enabled ?? false,
            // D-063: this account's own configured persona, not a hard-coded
            // "Sofía" — `weeklyReportEmail` itself falls back to that name
            // only when this is omitted or blank.
            receptionistName: profile?.persona_name,
          },
        });
        const subject = weeklyReportSubject(now);
        const replyTo = normalizeReplyTo(row.replyToEmail);

        // ONE send PER RECIPIENT, failures collected rather than awaited in a
        // bare loop — follows the lead alert's loop in
        // apps/web/src/app/f/[publicId]/actions.ts (~line 565), whose
        // comment records the bug this pattern exists to prevent: a bare
        // `await` loop threw on the first bad address and every later
        // recipient silently heard nothing about the lead.
        let anySent = false;
        for (const to of row.reportEmails) {
          try {
            await ctx.email.send({ accountId: row.accountId, kind: "operator.weekly_report", to, fromName: brand.name, replyTo, subject, body: text, html });
            c.sent++;
            anySent = true;
          } catch (e) {
            c.failed++;
            console.error(`weekly report send failed for account ${row.accountId} to ${to}: ${String(e)}`);
          }
        }

        // SEND-THEN-STAMP, once at least one recipient received it. All-fail
        // must NOT stamp, so the account retries inside the same Monday
        // band; a partial failure DOES stamp — the recipients who already
        // got it must not get it again next tick.
        if (anySent) {
          const stamp = await stampWithRetry(() => stampWeeklyReportSent(ctx.db, row.accountId, monday));
          if (!stamp.stamped) {
            c.unstamped++;
            console.error(
              `weekly report sent but NOT stamped for account ${row.accountId} after `
              + `${stamp.attempts} attempts — expect a duplicate next tick inside the band: ${String(stamp.lastError)}`,
            );
          }

          // Part C: the client's own history shows the report went out —
          // one row per account-week, exempt from quiet hours (it goes to
          // the OWNER, Monday morning). An isolated leg, like the stamp.
          try {
            await recordAutomationLog(ctx.db, {
              accountId: row.accountId, source: "weekly_report", channel: "email", contactId: null,
              subjectKey: `week:${monday}`, status: "sent",
            });
          } catch (e) {
            console.error(`weekly report: log write failed for account ${row.accountId}: ${String(e)}`);
          }
        }
      } catch (e) {
        c.failed++;
        console.error(`weekly report failed for account ${row.accountId}: ${String(e)}`);
      }
    }

    return c;
  },
};
