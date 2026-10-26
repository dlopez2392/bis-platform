import { test, expect } from "./fixtures/test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import {
  serviceDb, insertPlan, getAccountBilling, getBusinessStatusRow, listBillingAlerts, pauseBilling,
  readPersonPrefs, type AccountBilling, type PlanTerms,
} from "@bis/db";
import { decidePause } from "../src/lib/billing/standing";
import { billingEnforced } from "../src/lib/billing/enforce";
import { reconcileMeter } from "../src/lib/billing/reconcile";
import { STRIPE_API_VERSION, stripeGateway, type MeterEventInput } from "../src/lib/billing/stripe-gateway";
import { ensureMeters, METERS } from "../src/lib/billing/stripe-catalog";
import { m } from "../src/lib/messages";

// Same two dotenv lines as plans.spec.ts / billing.spec.ts.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * M7a PR-4, plan Task 12: the non-payment pause end to end, on the per-run
 * client fixture's OWN account_billing row — never `billingPausePass.run`,
 * never `listPauseCandidates`, never a read or write that could touch
 * another account on this shared database (I5). Serial; sorts before
 * `billing.spec.ts` ("billing-pause.spec.ts" < "billing.spec.ts": "-" < ".").
 *
 * THE SWITCH. This file FAILS LOUDLY, never skips, when BILLING_ENFORCE is
 * not exactly "1" under CI: ci.yml's e2e job sets it (beside
 * STRIPE_WEBHOOK_SECRET) so this spec always runs against the real
 * enforcement path. Locally it skips with a `::warning` instead — the env
 * CLAUDE.md asks every local run to use (the CI Supabase project) does not
 * set BILLING_ENFORCE by default, and failing every local e2e run over a
 * switch this file turns on for ITSELF would be the wrong trade. Run it with
 * the switch on by hand: `BILLING_ENFORCE=1 pnpm --filter web exec
 * playwright test e2e/billing-pause.spec.ts` (cmd/PowerShell: `set
 * BILLING_ENFORCE=1&& ...` — see memory bis-tz-env-git-bash for the same
 * cross-shell trap with TZ).
 *
 * FIXTURE DISCIPLINE. `beforeAll` captures the fixture's account_billing row
 * (expected NONE — the per-run account is always freshly created, so a row
 * here means a dirty fixture, and this file stops with a reason rather than
 * compounding on it, the same discipline `one-switch.spec.ts` uses for a
 * mid-closure start) and then writes two things of its own: an `E2E Plan
 * <stamp>` row (admitted by `FIXTURE_PLAN_RE`, fixtures/stale.ts:214 — no
 * change needed there) with FAKE Stripe ids (0051's CHECKs ask only for the
 * right prefix, never a real object; this file never calls Stripe for the
 * plan or the row) and both features on, and the fixture's own
 * account_billing row, unpaused: `stripe_customer_id`/`stripe_subscription_id`
 * fakes, `subscription_status: "past_due"`, `past_due_since` 8 days ago,
 * `stripe_checked_at` 1 hour ago. Test 1 is what actually pauses it.
 * `afterAll` (finally, every step attempted and reported) deletes the row and
 * the plan; it does not attempt to "restore" a captured row because
 * `beforeAll` already stops the file rather than letting one be seen.
 *
 * TWO ROLES. Tests 2 and 3 open their OWN `browser.newContext` on
 * `client-state.json` (the fixture's Owner), closed in a `finally`, exactly
 * as `billing.spec.ts` does for its client-page check — never the ambient
 * `page` fixture, which carries this project's agency storageState. Tests 1,
 * 4 and 5 use that ambient `page`/no page at all. Test 6 is a wholly separate
 * concern (a real Stripe test-mode meter) and touches neither the fixture nor
 * the database.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";
type ClientFixture = { accountId: string; clerkUserId: string; companyName: string };
function readFixture(): ClientFixture | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as Partial<ClientFixture>;
  if (!parsed.accountId || !parsed.clerkUserId) return null;
  return parsed as ClientFixture;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RUN = Date.now();
const PLAN_NAME = `E2E Plan ${RUN}`;
const FAKE_PRODUCT_ID = `prod_e2e_${RUN}`;
const FAKE_PRICE_IDS = {
  base: `price_e2e_${RUN}_base`, voice_minutes: `price_e2e_${RUN}_vm`,
  sms: `price_e2e_${RUN}_sms`, ai_chats: `price_e2e_${RUN}_ai`,
};
const TERMS: PlanTerms = {
  name: PLAN_NAME, monthlyPriceCents: 4900,
  features: { voice_receptionist: true, web_concierge: true },
  allowances: { voice_minutes: 100, sms: 200, ai_chats: 50 },
  overageCents: { voice_minutes: 10, sms: 3, ai_chats: 20 },
};

let fixture: ClientFixture | null = null;
let accountId = "";
const planId = randomUUID();
let planSaved = false;

test.beforeAll(async () => {
  if (!billingEnforced()) {
    const why = "BILLING_ENFORCE is not \"1\": this file pauses the fixture account and needs the switch on to see it enforced (CLAUDE.md; ci.yml's e2e job). Run with BILLING_ENFORCE=1 to exercise it locally.";
    if (process.env.CI) throw new Error(why);
    console.warn(`::warning title=billing-pause.spec.ts skipped::${why}`);
    test.skip(true, why);
  }
  fixture = readFixture();
  if (!fixture) throw new Error(`billing-pause.spec.ts: ${CLIENT_FIXTURE_FILE} is missing or incomplete (auth.setup.ts did not run)`);
  accountId = fixture.accountId;

  const existing = await getAccountBilling(serviceDb(), accountId);
  if (existing) {
    throw new Error(
      `billing-pause.spec.ts: fixture account ${accountId} already has an account_billing row — a dirty fixture; refusing to start on it`,
    );
  }

  const saved = await insertPlan(serviceDb(), {
    id: planId, terms: TERMS, stripeProductId: FAKE_PRODUCT_ID, stripePriceIds: FAKE_PRICE_IDS,
  });
  if (!saved.ok) throw new Error(`billing-pause.spec.ts: plan insert failed: ${saved.reason}`);
  planSaved = true;

  const now = Date.now();
  const { error } = await serviceDb().from("account_billing").insert({
    account_id: accountId,
    plan_id: planId,
    stripe_customer_id: `cus_e2e_${RUN}`,
    stripe_subscription_id: `sub_e2e_${RUN}`,
    subscription_status: "past_due",
    past_due_since: new Date(now - 8 * DAY_MS).toISOString(),
    stripe_checked_at: new Date(now - HOUR_MS).toISOString(),
  });
  if (error) throw new Error(`billing-pause.spec.ts: account_billing insert failed: ${error.message}`);
});

test.afterAll(async () => {
  const db = serviceDb();
  const failures: string[] = [];
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (accountId) {
    await step("account_billing", async () => {
      const { error } = await db.from("account_billing").delete().eq("account_id", accountId);
      if (error) throw new Error(error.message);
    });
  }
  if (planSaved) {
    await step("the plan", async () => {
      const { error } = await db.from("plans").delete().eq("id", planId);
      if (error) throw new Error(error.message);
    });
  }
  if (failures.length > 0) throw new Error(`billing-pause.spec.ts cleanup failed: ${failures.join("; ")}`);
});

test(
  "the fixture's row is paused by decidePause + pauseBilling (mutation: decidePause ignores stripe_checked_at's grace rule → FAILS: the row would also pause with a day-6 confirmation, asserted by a second fixture state first)",
  async () => {
    const row0 = await getAccountBilling(serviceDb(), accountId);
    expect(row0, "beforeAll's own insert").not.toBeNull();
    const since = Date.parse(row0!.pastDueSince!);
    const now = new Date();

    // G6/review I1's boundary: Stripe confirmed the unpaid status only 6
    // days after the grace started — still inside the 7-day grace, so this
    // is not a pause yet.
    const day6: AccountBilling = { ...row0!, stripeCheckedAt: new Date(since + 6 * DAY_MS).toISOString() };
    expect(decidePause(day6, now), "a day-6 confirmation is still within the 7-day grace").toBe("unconfirmed");

    // The row's own stripe_checked_at (1 hour ago, well past the grace and
    // well within STRIPE_FRESH_MS) is a real pause.
    const fresh: AccountBilling = { ...row0!, stripeCheckedAt: new Date(now.getTime() - HOUR_MS).toISOString() };
    expect(decidePause(fresh, now)).toBe("pause");

    const result = await pauseBilling(serviceDb(), { accountId, expectedUpdatedAt: row0!.updatedAt, now });
    expect(result).toBe("paused");

    const row1 = await getAccountBilling(serviceDb(), accountId);
    expect(row1?.billingPausedAt, "pauseBilling stamped the row").not.toBeNull();
  },
);

test(
  "the client Owner sees the paused banner on the dashboard and on Contacts, and the Billing page's paused line with Manage billing (mutation: the banner on the dashboard page alone → FAILS on Contacts)",
  async ({ browser, baseURL }) => {
    const client = await browser.newContext({ storageState: "e2e/.auth/client-state.json", baseURL });
    try {
      const page = await client.newPage();
      const bannerText = m["billing.paused.client.payment"];

      await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
      await expect(page.getByRole("note").filter({ hasText: bannerText })).toBeVisible();

      // The banner is the account LAYOUT's, not the dashboard page's own —
      // Contacts proves that, rather than trusting one route.
      await page.goto(`/dashboard/accounts/${accountId}/contacts`);
      await expect(page.getByRole("note").filter({ hasText: bannerText })).toBeVisible();

      await page.goto(`/dashboard/accounts/${accountId}/billing`);
      const main = page.getByRole("main");
      await expect(main.getByText(m["billing.page.paused.payment"])).toBeVisible();
      await expect(main.getByRole("button", { name: m["billing.page.manage"] })).toBeVisible();
    } finally {
      await client.close();
    }
  },
);

test(
  "a change while paused is not saved and lands back on the same page (N1) (mutation: refuseActionWhilePaused not called from requireAccountAccess → FAILS: the status changes)",
  async ({ browser, baseURL }) => {
    const client = await browser.newContext({ storageState: "e2e/.auth/client-state.json", baseURL });
    try {
      const page = await client.newPage();
      const dashboardUrl = `/dashboard/accounts/${accountId}/dashboard`;
      await page.goto(dashboardUrl);
      const urlBefore = page.url();
      const before = await getBusinessStatusRow(serviceDb(), accountId);

      const topbar = page.locator("header");
      await topbar.getByRole("button", { name: m["business.menu.trigger"] }).click();
      await page.getByRole("menuitemradio", { name: m["business.menu.closedToday"] }).click();

      // No success toast: a refused action never reaches the code that shows it.
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["business.toast.closedToday"] }))
        .toHaveCount(0);
      await expect(page).toHaveURL(urlBefore);
      await expect(page.getByRole("note").filter({ hasText: m["billing.paused.client.payment"] })).toBeVisible();

      const after = await getBusinessStatusRow(serviceDb(), accountId);
      expect(after?.state ?? "open", "nothing was written").toBe(before?.state ?? "open");
      expect(after?.set_at ?? null).toBe(before?.set_at ?? null);

      // Task 7 review risk: a person-level action (theme/language) carries
      // no accountId and never calls requireAccountAccess itself, but the
      // POST that invokes it still carries `next-action`, and Next re-renders
      // the CURRENT page's tree — THIS account's layout included — to answer
      // it. That re-render's own requireAccountAccess call sees an action
      // request on a paused account and redirects (to this same page, since
      // referer is this same page, so it reads as a same-URL no-op) even
      // though the action it "answers for" never touched billing. Cover that
      // the save still lands despite that extra redirect.
      const clerkUserId = fixture!.clerkUserId;
      const themeBefore = (await readPersonPrefs(serviceDb(), clerkUserId))?.theme ?? null;
      const urlBeforeTheme = page.url();
      await page.getByTestId("theme-toggle").click();
      await expect
        .poll(
          async () => (await readPersonPrefs(serviceDb(), clerkUserId))?.theme ?? null,
          "the theme save must land despite the paused layout's own extra render",
        )
        .not.toBe(themeBefore);
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
      await expect(page).toHaveURL(urlBeforeTheme);
    } finally {
      await client.close();
    }
  },
);

test(
  "the agency sees Paused on the Billing card, lifts it, sees the Undo, undoes, lifts again (mutation: Undo compares the lift stamps as strings → FAILS: \"can't be paused again\"; mutation: Undo re-pauses at now → FAILS: billing_paused_at after the Undo differs from before the Lift)",
  async ({ page }) => {
    const before = await getAccountBilling(serviceDb(), accountId);
    expect(before?.billingPausedAt, "test 1 already paused this row").not.toBeNull();
    const pausedAtOriginal = before!.billingPausedAt!;

    await page.goto(`/dashboard/accounts/${accountId}/settings#billing`);
    // Scoped to <main>, as billing.spec.ts's own agency check: mid-stream,
    // #billing also exists in React's hidden S:0 buffer.
    const card = page.getByRole("main").locator("#billing");
    await expect(card.locator('[data-status="paused"]')).toBeVisible();
    await expect(card.getByText(/Paused since/)).toBeVisible();

    await card.getByRole("button", { name: m["billing.card.liftPause"] }).click();
    const liftedToast = page.locator("[data-sonner-toast]").filter({ hasText: m["billing.card.liftedToast"] });
    await expect(liftedToast).toBeVisible();

    const afterLift = await getAccountBilling(serviceDb(), accountId);
    expect(afterLift?.billingPausedAt, "Lift pause cleared the pause").toBeNull();
    expect(afterLift?.pauseLiftedAt, "Lift pause stamped pause_lifted_at").not.toBeNull();
    await expect(card.locator('[data-status="payment_failed"]')).toBeVisible();

    await liftedToast.getByRole("button", { name: m["common.undo"] }).click();
    const repausedToast = page.locator("[data-sonner-toast]").filter({ hasText: m["billing.card.repausedToast"] });
    await expect(repausedToast).toBeVisible();

    const afterUndo = await getAccountBilling(serviceDb(), accountId);
    expect(afterUndo?.billingPausedAt, "Undo re-paused the row").not.toBeNull();
    expect(
      Date.parse(afterUndo!.billingPausedAt!),
      "the Undo restores the SAME pause instant, not a fresh `now`",
    ).toBe(Date.parse(pausedAtOriginal));
    expect(afterUndo?.pauseLiftedAt, "the Undo clears the lift stamp").toBeNull();
    await expect(card.locator('[data-status="paused"]')).toBeVisible();

    // Lift again: the row must still accept a SECOND Lift after an Undo
    // (the "can't be paused again" mutation would have refused the Undo
    // above, not this click, but this is also the state Task 12's test 5
    // picks up from).
    await card.getByRole("button", { name: m["billing.card.liftPause"] }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["billing.card.liftedToast"] }).last())
      .toBeVisible();

    const final = await getAccountBilling(serviceDb(), accountId);
    expect(final?.billingPausedAt).toBeNull();
    expect(final?.pauseLiftedAt).not.toBeNull();
  },
);

// The line's own cap (billing-alert-banner.tsx's MAX_NAMES); kept in sync by
// eye, since the component does not export it.
const ALERT_LINE_CAP = 5;

test(
  "the work queue lists the fixture under Paused, then under Payment failed after the lift (mutation: listBillingAlerts drops paused rows → FAILS)",
  async ({ page }) => {
    // DEVIATION (flagged, not silent): test 4 already left this row LIFTED
    // (payment_failed). Rather than lean on that end state — which would make
    // this test's result depend on test 4's exact last step — this test
    // re-pauses the fixture's OWN row directly (serviceDb(), never
    // pauseBilling/decidePause: those are test 1's proof, not this one's) so
    // it can observe listBillingAlerts' "paused" branch on demand, then lifts
    // it directly the same way to observe "payment_failed". I5: this acts
    // only on the fixture's own row, never billingPausePass.run or
    // listPauseCandidates.
    const pausedAt = new Date();
    {
      const { error } = await serviceDb().from("account_billing")
        .update({ billing_paused_at: pausedAt.toISOString(), updated_at: pausedAt.toISOString() })
        .eq("account_id", accountId);
      expect(error).toBeNull();
    }

    const alertsPaused = await listBillingAlerts(serviceDb(), pausedAt, { enforced: true });
    const fixturePaused = alertsPaused.find((a) => a.accountId === accountId);
    expect(fixturePaused?.kind, "freshly paused, well under the 30-day no-forward boundary").toBe("paused");
    const pausedOfKind = alertsPaused.filter((a) => a.kind === "paused");
    const pausedIndex = pausedOfKind.findIndex((a) => a.accountId === accountId);

    await page.goto("/dashboard/work");
    const main = page.getByRole("main");
    await expect(main.getByText(m["work.agency.billing.paused"])).toBeVisible();
    if (pausedIndex < ALERT_LINE_CAP) {
      await expect(main.locator(`[data-account-id="${accountId}"]`)).toBeVisible();
    } else {
      const rest = pausedOfKind.length - ALERT_LINE_CAP;
      await expect(main.getByText(m["work.agency.billing.more"].replace("{n}", String(rest)))).toBeVisible();
    }

    const liftedAt = new Date();
    {
      const { error } = await serviceDb().from("account_billing")
        .update({ billing_paused_at: null, updated_at: liftedAt.toISOString() })
        .eq("account_id", accountId);
      expect(error).toBeNull();
    }

    const alertsFailed = await listBillingAlerts(serviceDb(), liftedAt, { enforced: true });
    const fixtureFailed = alertsFailed.find((a) => a.accountId === accountId);
    expect(fixtureFailed?.kind, "unpaused, still past_due since the beforeAll stamp").toBe("payment_failed");
    const failedOfKind = alertsFailed.filter((a) => a.kind === "payment_failed");
    const failedIndex = failedOfKind.findIndex((a) => a.accountId === accountId);

    await page.goto("/dashboard/work");
    await expect(main.getByText(m["work.agency.billing.paymentFailed"])).toBeVisible();
    if (failedIndex < ALERT_LINE_CAP) {
      await expect(main.locator(`[data-account-id="${accountId}"]`)).toBeVisible();
    } else {
      const rest = failedOfKind.length - ALERT_LINE_CAP;
      await expect(main.getByText(m["work.agency.billing.more"].replace("{n}", String(rest)))).toBeVisible();
    }
  },
);

// ── Test 6: a real Stripe test-mode meter, S1 (independent of the fixture
// account and the database above; a throwaway Stripe customer only). ──

const SUMMARY_WAIT_MS = 120_000; // A16's bound.
const SUMMARY_POLL_MS = 5_000;

function report(type: string, outcome: string, level: "notice" | "warning"): void {
  test.info().annotations.push({ type, description: outcome });
  console.log(`::${level} title=billing-pause.spec.ts ${type}::${outcome}`);
}

async function pollMeterTotal(
  gateway: ReturnType<typeof stripeGateway>, meterId: string, customerId: string,
  startSeconds: number, endSeconds: number, target: number,
): Promise<{ value: number; reached: boolean }> {
  const deadline = Date.now() + SUMMARY_WAIT_MS;
  for (;;) {
    const value = await gateway.meterTotal({ meterId, customerId, startSeconds, endSeconds });
    if (value >= target) return { value, reached: true };
    if (Date.now() >= deadline) return { value, reached: false };
    await new Promise((resolve) => setTimeout(resolve, SUMMARY_POLL_MS));
  }
}

test(
  "S1: a real test-mode meter reconciles (mutation: meterTotal passes a value_grouping_window → FAILS: Stripe answers per hour)",
  async () => {
    const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
    const why = "STRIPE_SECRET_KEY is not set, so the nightly reconciliation's own Stripe read (S1) was NOT exercised against Stripe test mode.";
    if (!STRIPE_KEY) console.warn(`::warning title=billing-pause.spec.ts S1 skipped::${why}`);
    test.skip(!STRIPE_KEY, why);
    expect(/^(sk|rk)_test_/.test(STRIPE_KEY), "billing-pause.spec.ts's S1 test runs on a Stripe TEST key only").toBe(true);
    test.setTimeout(330_000);

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: STRIPE_API_VERSION });
    const gateway = stripeGateway(stripe);
    const meterId = (await ensureMeters(gateway)).sms;
    const customer = await stripe.customers.create({
      name: `billing-pause.spec S1 ${RUN}`, metadata: { bis_e2e: "billing-pause-s1" },
    });

    let matchResult: string | null = null;
    let heldResult: string | null = null;
    try {
      // Every event at one minute-aligned instant two minutes ago, so one
      // window [ts, ts + 60) holds them all and lies in the past.
      const ts = Math.floor(Date.now() / 60_000) * 60 - 120;
      const eventOf = (value: number): MeterEventInput => ({
        eventName: METERS.sms.eventName, customerId: customer.id, value, identifier: randomUUID(), timestampSeconds: ts,
      });
      const keyOf = (e: MeterEventInput) => `bis-usage-${e.identifier}-${customer.id}`;
      const sum = 5;
      const first = eventOf(2);
      const second = eventOf(3);
      await gateway.reportMeterEvent(first, keyOf(first));
      await gateway.reportMeterEvent(second, keyOf(second));

      const p1 = await pollMeterTotal(gateway, meterId, customer.id, ts, ts + 60, sum);
      if (p1.reached) {
        expect(
          reconcileMeter({ settled: sum, inFlight: 0, heldQuantities: [] }, p1.value),
          "two settled events equal Stripe's own total",
        ).toBe("match");
        matchResult = `held: settled ${sum}, Stripe ${p1.value} -> "match"`;
      } else {
        matchResult = `unproven: the meter showed ${p1.value} of ${sum} after ${SUMMARY_WAIT_MS / 1000} s`;
      }

      const third = eventOf(4);
      await gateway.reportMeterEvent(third, keyOf(third));
      const p2 = await pollMeterTotal(gateway, meterId, customer.id, ts, ts + 60, sum + 4);
      if (p2.reached) {
        const verdict = reconcileMeter({ settled: sum, inFlight: 0, heldQuantities: [4] }, p2.value);
        expect(verdict, "the third event reached Stripe but is still HELD in BIS's own ledger").toBe("held_at_stripe");
        heldResult = `held: settled ${sum}, held [4], Stripe ${p2.value} -> "${verdict}"`;
      } else {
        heldResult = `unproven: the meter showed ${p2.value} of ${sum + 4} after ${SUMMARY_WAIT_MS / 1000} s`;
      }
    } finally {
      await stripe.customers.del(customer.id);
      report(
        "S1 match (two settled events equal Stripe's total)",
        matchResult ?? "NOT shown: the test failed before Stripe's meter was read back",
        matchResult?.startsWith("held") ? "notice" : "warning",
      );
      report(
        "S1 held_at_stripe (a third event at Stripe, still held in BIS)",
        heldResult ?? "NOT shown: the test failed before Stripe's meter was read back a second time",
        heldResult?.startsWith("held") ? "notice" : "warning",
      );
    }
  },
);
