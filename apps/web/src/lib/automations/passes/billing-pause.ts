import { listPauseCandidates, pauseBilling, clearBillingPause } from "@bis/db";
import { billingEnforced } from "@/lib/billing/enforce";
import { decidePause } from "@/lib/billing/standing";
import type { Pass } from "../context";

/**
 * The non-payment pause (spec section 3 flows 5-6; plan G1, G16). FIRST in
 * the registry: a pause stamped this tick is read by every send gate in the
 * same tick (the release pass then re-holds rather than sends). No Stripe
 * call, no wall-clock budget: one paged read of the candidate rows and a
 * compare-and-set write per change. A lost race (`conflict`: the mirror or
 * the agency moved the row since the read) is counted `raced` and re-decided
 * next tick, never retried in this one.
 *
 * Switch OFF (BILLING_ENFORCE): counts what it WOULD do and writes nothing.
 * With it off the nightly re-read does not run, so past-due accounts mostly
 * count as `unconfirmed` (their stamp is only as fresh as the last webhook);
 * the log names every account past the grace either way.
 *
 * It sends nothing, so `accounts.outbound_suppressed` has nothing to gate
 * here: a demo account has no Stripe subscription and is never a candidate.
 *
 * Every @bis/db export is dereferenced inside run(), never at module scope
 * (static named imports are live bindings: a bare `vi.mock("@bis/db")`
 * factory throws only when one is touched).
 */
export const billingPausePass: Pass = {
  key: "billingPause",
  async run(ctx) {
    const c = { paused: 0, unpaused: 0, raced: 0, unconfirmed: 0, failed: 0, wouldPause: 0, wouldUnpause: 0 };
    const enforced = billingEnforced();
    for (const row of await listPauseCandidates(ctx.db)) {
      const decision = decidePause(row, ctx.now);
      if (decision === "keep") continue;
      if (decision === "unconfirmed") {
        c.unconfirmed++;
        // m4: expected every tick until the nightly re-read confirms it, so an
        // info line (and the counter), never console.error each tick.
        console.log(`billing pause: account ${row.accountId} is past the grace but Stripe has not confirmed it since; not paused this tick`);
        continue;
      }
      if (!enforced) {
        if (decision === "pause") c.wouldPause++; else c.wouldUnpause++;
        console.log(`billing pause (switch off): would ${decision} account ${row.accountId}`);
        continue;
      }
      try {
        const r = decision === "pause"
          ? await pauseBilling(ctx.db, { accountId: row.accountId, expectedUpdatedAt: row.updatedAt, now: ctx.now })
          : await clearBillingPause(ctx.db, { accountId: row.accountId, expectedUpdatedAt: row.updatedAt, now: ctx.now, lift: false });
        if (r === "conflict") { c.raced++; continue; }
        if (decision === "pause") { c.paused++; console.log(`billing pause: paused account ${row.accountId}`); }
        else { c.unpaused++; console.log(`billing pause: cleared the pause of paid account ${row.accountId}`); }
      } catch (e) {
        c.failed++;
        console.error(`billing pause: ${decision} failed for account ${row.accountId}: ${String(e)}`);
      }
    }
    return c;
  },
};
