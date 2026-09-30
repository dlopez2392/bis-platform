import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import {
  STRIPE_API_VERSION, meterEventFailureKind, meterEventParams, stripeGateway, type MeterEventInput,
} from "../src/lib/billing/stripe-gateway";
import { ensureMeters, METERS } from "../src/lib/billing/stripe-catalog";

// Same two dotenv lines as plans.spec.ts.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// Client billing, usage reporting: the one thing only a real Stripe can
// prove. The cron's usage report sends each usage row as a v1 meter event
// through `reportMeterEvent`; its unit tests run against FakeGateway, which
// is only as right as our reading of Stripe. A 200 from Stripe proves only
// that it RECEIVED an event (it validates asynchronously), so this reads
// Stripe's own aggregate for a throwaway customer and asserts the sum a
// correct dedupe implies:
//   phase 1: event 1 (2), the same request replayed under the same key, a
//            distinct event 2 (3)                       → 5    (A9, A10)
//   phase 2: event 1's identifier under a NEW key (A11). Stripe may refuse
//            it outright ("An event already exists with identifier <id>.")
//            — the spec asserts `meterEventFailureKind` reads that refusal
//            as "duplicate", the class the usage report stamps a row on
//            instead of retrying it forever; a mismatch here means Stripe
//            reworded the message and ALREADY_EXISTS in stripe-gateway.ts
//            is silently falling back to "row" in production. Or Stripe may
//            accept it silently, in which case a sentinel (7) follows and
//            the aggregate must land on 12 (deduplicated) or 14 (counted
//            again).
//
// No database and no account: a throwaway Stripe TEST customer, deleted at
// the end. STRIPE TEST MODE ONLY: CI's target guard refuses a live key before
// any step runs, and this file re-checks the prefix before its first call.
// The e2e job has no CRON_SECRET, so the cron route itself is not driven here.
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const NO_STRIPE =
  "STRIPE_SECRET_KEY is not set, so BIS's usage meter event was NOT sent to Stripe test mode. Add the Stripe TEST secret key (sk_test_) as the repository secret CI_STRIPE_SECRET_KEY, or locally only once apps/web/.env.local points at a non-production database.";
const RUN = Date.now();

/** Assumption A16: Stripe's summaries show an accepted event within this. */
const SUMMARY_WAIT_MS = 120_000;
const SUMMARY_POLL_MS = 5_000;
/** After the sentinel appears, one more read this much later (A17). */
const SETTLE_MS = 30_000;

type Sum = { value: number; reached: boolean };

/** The customer's aggregate on the meter for [startTime, startTime + 60 s),
 *  polled until it reaches `target` or the wait runs out. */
async function waitForSum(
  stripe: Stripe, meterId: string, customer: string, startTime: number, target: number,
): Promise<Sum> {
  const deadline = Date.now() + SUMMARY_WAIT_MS;
  for (;;) {
    const page = await stripe.billing.meters.listEventSummaries(meterId, {
      customer, start_time: startTime, end_time: startTime + 60,
    });
    const value = page.data.reduce((sum, s) => sum + s.aggregated_value, 0);
    if (value >= target) return { value, reached: true };
    if (Date.now() >= deadline) return { value, reached: false };
    await new Promise((resolve) => setTimeout(resolve, SUMMARY_POLL_MS));
  }
}

function report(type: string, outcome: string, level: "notice" | "warning"): void {
  test.info().annotations.push({ type, description: outcome });
  console.log(`::${level} title=usage-meter.spec.ts ${type}::${outcome}`);
}

test.describe("usage reaches Stripe as meter events, counted once", () => {
  test("Stripe test mode counts BIS's meter event once, replay included; a reused identifier under a new key is observed", async () => {
    if (!STRIPE_KEY) console.warn(`::warning title=usage-meter.spec.ts skipped::${NO_STRIPE}`);
    test.skip(!STRIPE_KEY, NO_STRIPE);
    expect(/^(sk|rk)_test_/.test(STRIPE_KEY), "usage-meter.spec.ts runs on a Stripe TEST key only").toBe(true);
    test.setTimeout(330_000);

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: STRIPE_API_VERSION });
    const gateway = stripeGateway(stripe);
    // The meters the Plans page makes; created here if this test account has
    // never saved a plan (idempotent, the Plans page's own keys).
    const meterId = (await ensureMeters(gateway)).sms;
    const customer = await stripe.customers.create({
      name: `usage-meter.spec ${RUN}`, metadata: { bis_e2e: "usage-meter" },
    });

    let bodyOk = false;
    try {
      // Every event at one minute-aligned instant two minutes ago, so one
      // summary window [ts, ts + 60) holds them all and lies in the past.
      const ts = Math.floor(Date.now() / 60_000) * 60 - 120;
      const eventOf = (value: number): MeterEventInput => ({
        eventName: METERS.sms.eventName, customerId: customer.id, value, identifier: randomUUID(), timestampSeconds: ts,
      });
      // The key shape the usage report builds (usageIdempotencyKey).
      const keyOf = (e: MeterEventInput) => `bis-usage-${e.identifier}-${customer.id}`;

      // ── Phase 1: A9 (accepted and mapped to this customer) and A10 (a
      // replay under the same key adds nothing). ──
      const first = eventOf(2);
      const second = eventOf(3);
      await gateway.reportMeterEvent(first, keyOf(first));
      await gateway.reportMeterEvent(first, keyOf(first));   // a lost response, retried
      await gateway.reportMeterEvent(second, keyOf(second));
      const p1 = await waitForSum(stripe, meterId, customer.id, ts, 5);
      if (p1.reached) {
        // WRONG, not late: more than 5 means the replay was counted (A10) or
        // the mapping is off (A9). A replay under the same key is answered
        // from Stripe's idempotency cache, so it cannot arrive later.
        expect(p1.value, "Stripe's sum for event 1 (2), its replay, and event 2 (3)").toBe(5);
        report("A9/A10", "deduplicated as expected (5)", "notice");
      } else {
        report("A9/A10", `unproven: the summary showed ${p1.value} of 5 after ${SUMMARY_WAIT_MS / 1000} s`, "warning");
      }

      // ── Phase 2: A11, observed, never assumed. The only acceptable refusal
      // is an invalid request (the reporter's row-specific class). ──
      // Only the probe itself sits in the try, so a failed assertion below
      // can never be mistaken for Stripe refusing the probe.
      let refusal: { type?: string; code?: string; message?: string } | null = null;
      try {
        await stripe.billing.meterEvents.create(meterEventParams(first), {
          idempotencyKey: `bis-usage-probe-${randomUUID()}`,
        });
      } catch (e) {
        refusal = e as { type?: string; code?: string; message?: string };
      }
      let a11: string;
      if (refusal) {
        const detail = `${refusal.type ?? "?"} ${refusal.code ?? ""} ${refusal.message ?? ""}`.trim();
        expect(refusal.type, "a reused identifier may be refused only as an invalid request (the reporter's row-specific class)")
          .toBe("StripeInvalidRequestError");
        // Not just that Stripe refused — that the report's OWN classifier
        // reads this exact refusal as "duplicate". If Stripe rewords the
        // message, ALREADY_EXISTS in stripe-gateway.ts stops matching,
        // meterEventFailureKind silently falls back to "row", and a billed
        // account's usage row is retried (never stamped) every tick instead
        // of being recognized as already-reported.
        expect(
          meterEventFailureKind(refusal, first.identifier),
          "meterEventFailureKind must classify Stripe's real A11 refusal as \"duplicate\"; a \"row\" result here means "
            + "ALREADY_EXISTS in stripe-gateway.ts no longer matches Stripe's wording and the usage report will wedge",
        ).toBe("duplicate");
        a11 = `refused, handled: ${detail} (classified duplicate → stamped)`;
      } else {
        // A sentinel AFTER the probe (A17): once it shows, the probe has
        // been counted or deduplicated.
        const sentinel = eventOf(7);
        await gateway.reportMeterEvent(sentinel, keyOf(sentinel));
        const seen = await waitForSum(stripe, meterId, customer.id, ts, 12);
        let value = seen.value;
        if (seen.reached) {
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
          value = (await waitForSum(stripe, meterId, customer.id, ts, 12)).value;
          // 12 and 14 are the two answers Stripe can give; anything else is WRONG.
          expect([12, 14], `Stripe's sum after the A11 probe and the sentinel was ${value}, which no outcome explains`)
            .toContain(value);
        }
        a11 = !seen.reached
          ? `unproven: accepted, and the summary showed ${value} of 12 after ${SUMMARY_WAIT_MS / 1000} s`
          : value === 12 ? "deduplicated as expected (12)" : "accepted but double-counted (14)";
      }
      // "deduplicated as expected" (accepted silently, deduped by Stripe) and
      // "refused, handled" (refused, classified duplicate, stamped) are both
      // understood, handled outcomes; "unproven" and "accepted but
      // double-counted" stay warnings.
      const a11Handled = a11.startsWith("deduplicated") || a11.startsWith("refused, handled");
      report("A11 same identifier, new idempotency key", a11, a11Handled ? "notice" : "warning");
      bodyOk = true;
    } finally {
      try {
        await stripe.customers.del(customer.id);
      } catch (e) {
        // Thrown only when the body passed: a throw from finally would
        // REPLACE the primary failure.
        const msg = `usage-meter.spec cleanup failed on Stripe customer ${customer.id}: ${String(e)}`;
        if (bodyOk) throw new Error(msg);
        console.error(msg);
      }
    }
  });
});
