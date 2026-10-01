import { getAgencyReportTarget, listHeartbeats, markAlerted, type HeartbeatRow } from "@bis/db";
import { composeOpsEmail, evaluate, type Heartbeat } from "@/lib/ops/watch";
import type { Pass } from "../context";

/**
 * The operational floor's alert pass (spec §2): reads the heartbeats the
 * harness and the routes write, and emails BIS about what is failing and
 * what has recovered. The rules themselves are a pure function
 * (`lib/ops/watch.ts`); this pass is the I/O around them.
 *
 * Registered LAST, so the rows it reads include this very tick's passes: a
 * pass that just failed for the second time is reported now, not in fifteen
 * minutes.
 *
 * WHERE IT GOES. The agency's report address (the one the weekly roll-up
 * uses), else AGENCY_SUPPORT_EMAIL, else hello@bis-rgv.com, which forwards to
 * the BIS inbox (decision 4). An operator kind: no unsubscribe footer, any
 * hour. English and plain: BIS staff read it, not a client.
 *
 * SEND-THEN-MARK, and the order is the contract. The email goes first; only
 * once it has gone is each key marked (or, for a recovery, cleared). A send
 * that fails leaves the keys unmarked, so the next tick tries again: a
 * duplicate alert beats a lost one. A mark that fails after a good send is
 * counted `unmarked` and means one repeat email next tick, never silence.
 */
export const OPS_ALERT_FALLBACK = "hello@bis-rgv.com";

export const opsWatchPass: Pass = {
  key: "opsWatch",
  async run(ctx) {
    const c = { alerted: 0, recovered: 0, sent: 0, failed: 0, unmarked: 0 };

    const verdict = evaluate((await listHeartbeats(ctx.db)).map(toHeartbeat), ctx.now);
    const mail = composeOpsEmail(verdict);
    if (!mail) return c;

    const agency = await getAgencyReportTarget(ctx.db);
    const to = agency?.reportEmail ?? (process.env.AGENCY_SUPPORT_EMAIL?.trim() || OPS_ALERT_FALLBACK);

    try {
      await ctx.email.send({ accountId: null, kind: "operator.ops_alert", to, fromName: "BIS platform", subject: mail.subject, body: mail.body, now: ctx.now });
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`ops alert NOT sent (will retry next tick): ${String(e)}`);
      return c;
    }

    for (const h of verdict.alert) {
      try { await markAlerted(ctx.db, h.key, ctx.now); c.alerted++; } catch (e) {
        c.unmarked++;
        console.error(`ops alert sent but ${h.key} NOT marked — expect a repeat next tick: ${String(e)}`);
      }
    }
    for (const h of verdict.recovered) {
      try { await markAlerted(ctx.db, h.key, null); c.recovered++; } catch (e) {
        c.unmarked++;
        console.error(`ops recovery sent but ${h.key} NOT cleared — expect a repeat next tick: ${String(e)}`);
      }
    }
    return c;
  },
};

const at = (iso: string | null) => (iso ? new Date(iso) : null);

export function toHeartbeat(row: HeartbeatRow): Heartbeat {
  return {
    key: row.key,
    lastOkAt: at(row.lastOkAt),
    lastErrorAt: at(row.lastErrorAt),
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
    alertedAt: at(row.alertedAt),
  };
}
