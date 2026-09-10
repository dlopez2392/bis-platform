import { getAgencyReportTarget, stampAgencyReportSent, listAccountsForWeeklyRollup, type Branding } from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { agencyRollupEmail, type RollupRow } from "@/lib/email/templates/agency-rollup";
import { weeklyMetrics } from "@/lib/reports/weekly-metrics";
import { inMondayBand, lastWeekMonday, weekWindow } from "@/lib/reports/weekly-window";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import type { Pass } from "../context";

/**
 * The agency's own email has no client to draw branding from — it is BIS's
 * mail, not a client's. Every visual field null degrades `emailBrandNamed`
 * to exactly the platform's unthemed default (the same violet a client with
 * no brand of its own gets everywhere else), which is the right identity for
 * a message about the whole book of business rather than any one account.
 */
const BIS_BRANDING: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};

/** An individual account's own zone cannot resolve is a per-row degradation
 *  here, never a reason to drop the row — see `weeklyAgencyReportPass` below. */
const FALLBACK_ZONE = "America/Chicago";

/**
 * The agency's Monday-morning roll-up: one row per account, in the SAME
 * `weeklyMetrics` the client email calls, each computed in THAT ACCOUNT's
 * own zone (spec 2026-09-10-weekly-report-design, "weeklyAgencyReportPass").
 * That is the entire reason `weeklyMetrics` is a shared function rather than
 * two sets of queries in two passes: a roll-up row and the number the client
 * itself received must never disagree.
 *
 * The AGENCY's own zone (`agencies.timezone`) gates the SEND only — whether
 * NOW is an acceptable Monday morning to mail the agency — exactly the way
 * `weeklyClientReportPass` gates each client's send in that client's zone.
 * It has no bearing on what any one row's numbers say.
 *
 * One row, one send: unlike the client pass (independently many accounts,
 * each its own try/catch), the roll-up is a single unit of work — the whole
 * compute-then-send-then-stamp block shares one try/catch, and a failure
 * anywhere in it is one `failed`, not a partial mail with some rows missing.
 */
export const weeklyAgencyReportPass: Pass = {
  key: "weeklyAgencyReport",
  async run(ctx) {
    const c = {
      sent: 0, failed: 0, skippedNoRecipient: 0, skippedNotMonday: 0,
      skippedAlreadySent: 0, unresolvableTimezone: 0, unstamped: 0,
    };

    const agency = await getAgencyReportTarget(ctx.db);
    // No agency row at all is treated the same as an unset address: either
    // way there is nowhere to send this, and the visible-skip contract is
    // the same one migration 0031 built `report_email` nullable for — fail
    // VISIBLY in the cron JSON rather than silently sending nothing.
    if (!agency || agency.reportEmail === null) {
      c.skippedNoRecipient++;
      return c;
    }
    const reportEmail = agency.reportEmail;

    const zone = resolveAccountZone(agency.timezone);
    if (zone === null) {
      c.unresolvableTimezone++;
      console.error(
        `weekly agency report HELD: agency timezone ${JSON.stringify(agency.timezone)} `
        + `is not a zone we can resolve — fix agencies.timezone`,
      );
      return c;
    }

    if (!inMondayBand(ctx.now, zone)) {
      c.skippedNotMonday++;
      return c;
    }

    // The Monday of the week that just ended — both the window key and what
    // gets stamped on success, exactly as the client pass does for an
    // account, just gated on the agency's own zone instead.
    const monday = lastWeekMonday(ctx.now, zone);
    if (monday === agency.lastSentWeek) {
      c.skippedAlreadySent++;
      return c;
    }

    try {
      const accounts = await listAccountsForWeeklyRollup(ctx.db);

      const rows: RollupRow[] = await Promise.all(accounts.map(async (a): Promise<RollupRow> => {
        // THE RULE this task exists to get right: THIS ACCOUNT's own zone,
        // never the agency's — falling back to the platform default rather
        // than dropping the row when a stored zone cannot resolve. Unlike
        // the client SEND path (which fails closed because a wrong hour
        // would reach a real customer), this is agency-only visibility
        // math: a fallback zone still produces a defensible window, and the
        // roll-up's rule is that EVERY account gets a row, no exceptions.
        const acctZone = resolveAccountZone(a.accountTimezone) ?? FALLBACK_ZONE;
        const acctWindow = weekWindow(lastWeekMonday(ctx.now, acctZone), acctZone);
        const priorMonday = lastWeekMonday(new Date(acctWindow.fromIso), acctZone);
        const priorWindow = weekWindow(priorMonday, acctZone);
        // FABRICATED-DELTA GUARD, same as the client pass: an account
        // younger than the prior window has no honest "week before".
        const priorValid = Date.parse(priorWindow.fromIso) >= Date.parse(a.createdAt);

        const [numbers, prior] = await Promise.all([
          weeklyMetrics(ctx.db, a.accountId, acctWindow, a.hasSite),
          priorValid ? weeklyMetrics(ctx.db, a.accountId, priorWindow, a.hasSite) : Promise.resolve(null),
        ]);

        return { brandName: a.brandName, numbers, prior, hasRecipients: a.hasRecipients };
      }));

      const brand = emailBrandNamed(BIS_BRANDING, "BIS");
      const { html, text } = agencyRollupEmail({ brand, rows });
      const subject = `Weekly roll-up — ${rows.length} account${rows.length === 1 ? "" : "s"}`;

      await ctx.email.send({ to: reportEmail, fromName: brand.name, subject, body: text, html });
      c.sent++;

      // SEND-THEN-STAMP: a stamp failure after a successful send counts
      // `unstamped` rather than being retried here — the reminders
      // precedent, which errs toward a duplicate over silence.
      const stamp = await stampWithRetry(() => stampAgencyReportSent(ctx.db, agency.agencyId, monday));
      if (!stamp.stamped) {
        c.unstamped++;
        console.error(
          `weekly agency report sent but NOT stamped after ${stamp.attempts} attempts — `
          + `expect a duplicate next tick inside the band: ${String(stamp.lastError)}`,
        );
      }
    } catch (e) {
      c.failed++;
      console.error(`weekly agency report failed: ${String(e)}`);
    }

    return c;
  },
};
