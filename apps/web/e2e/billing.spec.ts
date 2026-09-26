import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import { insertPlan, serviceDb, type PlanTerms, type StripePriceIds } from "@bis/db";
import {
  PORTAL_FEATURES, PORTAL_VERSION, STRIPE_API_VERSION, portalFeatureFlags, stripeGateway, type PortalFeature,
} from "../src/lib/billing/stripe-gateway";
import { syncPlanToStripe } from "../src/lib/billing/stripe-catalog";
import { m } from "../src/lib/messages";

// Same two dotenv lines as plans.spec.ts.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// Client billing, rollout step 3 (M7a PR-3, plan Task 12): the agency sends a
// billing link, Stripe's signed webhook makes the account billed, both
// Billing screens show it, and Manage billing opens Stripe's portal.
//
// STRIPE TEST MODE ONLY, on the per-run fixture account ("E2E Client Co"),
// never Test Client One: this spec writes account_billing, billing_links,
// accounts.permissions and a webhook event row. The webhook secret is ci.yml's
// fixture literal: the e2e server verifies with it, and this spec signs with
// it. Stripe's hosted Checkout page is NOT driven (plan Task 12, spec section
// 6): the subscription is made through the API on the link's own customer,
// exactly as Checkout would make it, and the webhook that announces it is
// signed here.
//
// Every claim about Stripe this spec observes is an ASSUMPTION with a number
// (the plan's B1, B3, B9; B12–B14 are this file's; X1 and X2 are
// billing-actions.ts's). Each outcome is an annotation plus a ::notice (held)
// or a ::warning (not shown, or not observed), whether the test passes or not.
//
//   B1   Checkout accepts one licensed price plus three metered prices (no
//        quantity) in ONE subscription-mode session.            (test 1)
//   B12  Checkout and the portal accept the e2e server's plain-http localhost
//        origin as their return URLs (CI sets no APP_ORIGIN).   (tests 1, 2)
//   B13  A subscription made through the API on pm_card_visa with the plan's
//        four prices is `active` at once (its first invoice paid in the
//        create call): this spec's stand-in for Checkout's own. (test 2)
//   B14  A link's Checkout session stays `open` after a subscription is made
//        on its customer outside it; so this spec expires it.  (test 2)
//   X1   Stripe refuses to expire a session that is no longer `open`.
//        Observed on an EXPIRED session. The COMPLETED case, which
//        settleDeadLink relies on, is NOT observable here: stripe 22.6.2's
//        Checkout.Sessions has no call that completes a session (list, create,
//        retrieve, update, expire, listLineItems), so only the hosted page
//        can, and it is not driven.                             (test 2)
//   X2   An expired session can never be paid, a payment mid-3-D-Secure
//        included. NOT observed (it needs the hosted page); always a warning.
//   B3   The portal configuration BIS creates in code (features + metadata
//        only) is usable: Manage billing lands on billing.stripe.com. And the
//        configuration BIS uses reads back from Stripe EXACTLY equal to
//        portalFeatureFlags(): one that read back drifted would be passed
//        over and replaced on every click (portal.ts).            (test 2)
//   B9   redirect() to an absolute external URL from a server action works in
//        Next 16: the same click.                                (test 2)
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
const SKIP = "STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not set, so the billing link, the Stripe webhook and both Billing screens were NOT exercised against Stripe test mode.";
const TEST_KEY = /^(sk|rk)_test_/;
// A real Date.now() stamp (13 digits): FIXTURE_PLAN_RE (fixtures/stale.ts)
// admits `E2E Plan <stamp>`, so a killed run's plan is swept.
const RUN = Date.now();
const PLAN_NAME = `E2E Plan ${RUN}`;
const RECIPIENT = `e2e-billing-${RUN}@example.com`;
const TERMS: PlanTerms = {
  name: PLAN_NAME, monthlyPriceCents: 4900, features: { voice_receptionist: false, web_concierge: true },
  allowances: { voice_minutes: 100, sms: 200, ai_chats: 50 }, overageCents: { voice_minutes: 10, sms: 3, ai_chats: 20 },
};
/** Polite, bounded: every Stripe-backed step here is one request or a few. */
const STRIPE_STEP_MS = 30_000;

function report(type: string, outcome: string, level: "notice" | "warning"): void {
  test.info().annotations.push({ type, description: outcome });
  console.log(`::${level} title=billing.spec.ts ${type}::${outcome}`);
}

/** An error as one line: the SDK's class, Stripe's code, the message. Never
 *  a header or a key: Stripe's messages here name sessions, not secrets. */
function errorLine(e: unknown): string {
  const o = typeof e === "object" && e !== null ? (e as { type?: unknown; code?: unknown; message?: unknown }) : {};
  const kind = typeof o.type === "string" ? o.type : e instanceof Error ? e.name : typeof e;
  const code = typeof o.code === "string" ? ` code=${o.code}` : "";
  const message = (typeof o.message === "string" ? o.message : String(e)).split("\n")[0] ?? "";
  return `${kind}${code}: ${message}`.slice(0, 300);
}

/** Every ACTIVE portal configuration tagged as BIS's, as Stripe reads it back
 *  now: its id and its five features' ON/OFF, straight from the SDK (not
 *  through the gateway, whose own mapping is what this checks). */
async function taggedPortalConfigurations(stripe: Stripe): Promise<{ id: string; features: Record<PortalFeature, boolean> }[]> {
  const page = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  expect(page.has_more, "more than 100 active portal configurations: this read cannot see them all").toBe(false);
  return page.data.filter((c) => c.metadata?.bis_portal === PORTAL_VERSION).map((c) => ({
    id: c.id,
    features: Object.fromEntries(PORTAL_FEATURES.map((f) => [f, c.features[f].enabled])) as Record<PortalFeature, boolean>,
  }));
}

test.describe.configure({ mode: "serial" });

test.describe("client billing: the link, the webhook, both Billing screens (Stripe test mode)", () => {
  let stripe: Stripe | null = null;
  let accountId = "";
  const planId = randomUUID();
  let planSaved = false;
  let productId = "";
  let priceIds: StripePriceIds;
  let customerId = "";
  let sessionId = "";
  let subscriptionId = "";
  const eventId = `evt_e2e_${RUN}`;
  // Each test's LAST line bumps this, so afterAll can tell a cleanup failure
  // after a green run (thrown) from one after a red run (logged, never
  // masking the test's own failure).
  let passed = 0;

  test.beforeAll(async () => {
    if (!STRIPE_KEY || !WEBHOOK_SECRET) console.warn(`::warning title=billing.spec.ts skipped::${SKIP}`);
    test.skip(!STRIPE_KEY || !WEBHOOK_SECRET, SKIP);
    // Before the first Stripe call. CI's target guard refuses a live key
    // before any step runs; this is the file's own check.
    expect(TEST_KEY.test(STRIPE_KEY), "billing.spec.ts runs on a Stripe TEST key only").toBe(true);
    test.setTimeout(120_000);
    stripe = new Stripe(STRIPE_KEY, { apiVersion: STRIPE_API_VERSION });
    accountId = (JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as { accountId: string }).accountId;
    const made = await syncPlanToStripe(stripeGateway(stripe), planId, TERMS, null);
    productId = made.productId;
    priceIds = made.priceIds;
    const saved = await insertPlan(serviceDb(), { id: planId, terms: TERMS, stripeProductId: productId, stripePriceIds: priceIds });
    expect(saved.ok, "the e2e plan row was written").toBe(true);
    planSaved = true;
  });

  test.afterAll(async () => {
    if (!STRIPE_KEY || !WEBHOOK_SECRET) return;
    test.setTimeout(120_000);
    const db = serviceDb();
    const failures: string[] = [];
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${label}: ${errorLine(e)}`);
      }
    };
    const dbStep = (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) =>
      step(label, async () => { const { error } = await run(); if (error) throw new Error(error.message); });

    // A test that failed between the Send and its own read of the link left
    // the customer and session unrecorded: pick them up from the row.
    if (accountId && (!customerId || !sessionId)) {
      await step("read the link row", async () => {
        const { data, error } = await db.from("billing_links")
          .select("stripe_customer_id, checkout_session_id").eq("account_id", accountId).maybeSingle();
        if (error) throw new Error(error.message);
        const row = data as { stripe_customer_id: string; checkout_session_id: string } | null;
        if (row) {
          customerId ||= row.stripe_customer_id;
          sessionId ||= row.checkout_session_id;
        }
      });
    }
    // Stripe first for the subscription (it bills), then the rows in FK
    // order: account_billing and billing_links both RESTRICT the plan's
    // delete (0051, 0052), so they go before it.
    const live = stripe && TEST_KEY.test(STRIPE_KEY) ? stripe : null;
    if (live && subscriptionId) await step("cancel the subscription", () => live.subscriptions.cancel(subscriptionId));
    if (accountId) {
      await dbStep("account_billing", () => db.from("account_billing").delete().eq("account_id", accountId));
      await dbStep("billing_links", () => db.from("billing_links").delete().eq("account_id", accountId));
      await dbStep("permissions", () => db.from("accounts").update({ permissions: {} }).eq("id", accountId));
    }
    await dbStep("the webhook event", () => db.from("stripe_webhook_events").delete().eq("event_id", eventId));
    if (live && sessionId) {
      // Payable until expired: close it if a failed test left it open.
      await step("expire the session", async () => {
        if ((await live.checkout.sessions.retrieve(sessionId)).status === "open") await live.checkout.sessions.expire(sessionId);
      });
    }
    if (live && customerId) await step("delete the customer", () => live.customers.del(customerId));
    if (planSaved) await dbStep("the plan", () => db.from("plans").delete().eq("id", planId));
    if (live && productId) await step("deactivate the product", () => live.products.update(productId, { active: false }));

    if (failures.length > 0) {
      const msg = `billing.spec cleanup failed: ${failures.join("; ")}`;
      // Thrown only after a green run: a throw here would otherwise REPLACE
      // the test's own failure (usage-meter.spec.ts's rule).
      if (passed === 2) throw new Error(msg);
      console.error(msg);
    }
  });

  test("the agency sends a billing link: Stripe test mode takes the plan's four prices in ONE subscription Checkout (B1), and the card says Link sent", async ({ page }) => {
    test.setTimeout(120_000);
    let b1: string | null = null;
    try {
      await page.goto(`/dashboard/accounts/${accountId}/settings#billing`);
      const card = page.locator("#billing");
      await expect(card.locator('[data-status="unbilled"]')).toBeVisible();
      await card.getByRole("button", { name: m["billing.send"] }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(m["billing.send.plan"], { exact: true }).click();
      await page.getByRole("option", { name: new RegExp(`^${PLAN_NAME} `) }).click();
      await dialog.getByLabel(m["billing.send.email"], { exact: true }).fill(RECIPIENT);
      await dialog.getByRole("button", { name: m["billing.send"] }).click();
      // The Send makes a customer and a session at Stripe before it answers.
      await expect(page.getByText(m["billing.send.done"])).toBeVisible({ timeout: STRIPE_STEP_MS });
      await expect(card.locator('[data-status="link_sent"]')).toBeVisible();

      const { data: link, error } = await serviceDb().from("billing_links")
        .select("stripe_customer_id, checkout_session_id, sent_to").eq("account_id", accountId).single();
      expect(error).toBeNull();
      const row = link as { stripe_customer_id: string; checkout_session_id: string; sent_to: string };
      customerId = row.stripe_customer_id;
      sessionId = row.checkout_session_id;
      expect(row.sent_to).toBe(RECIPIENT);

      // B1: Stripe's own copy of the session, read back.
      const session = await stripe!.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
      expect([session.mode, session.status, session.client_reference_id, session.customer])
        .toEqual(["subscription", "open", accountId, customerId]);
      const lines = session.line_items?.data ?? [];
      expect(session.line_items?.has_more, "all of the session's line items in one page").toBe(false);
      expect(lines.map((l) => l.price?.id).sort()).toEqual(Object.values(priceIds).sort());
      const base = lines.find((l) => l.price?.id === priceIds.base);
      expect(base?.quantity, "the flat price, once").toBe(1);
      const metered = lines.filter((l) => l.price?.recurring?.usage_type === "metered").length;
      expect(metered, "the three prices Stripe measures").toBe(3);
      b1 = `held: session ${session.id} is subscription-mode and open, with ${lines.length} line items (1 licensed, quantity 1; ${metered} metered)`;
      report("B12 localhost return URLs", `held for Checkout: session ${session.id} was created with success_url and cancel_url on http://localhost:3000`, "notice");
      passed += 1;
    } finally {
      report("B1 one flat + three metered prices in one Checkout", b1 ?? "NOT shown: the test failed before Stripe's session was read back (the failure above says where)", b1 ? "notice" : "warning");
    }
  });

  test("a signed webhook makes the account billed — once — and both screens show it; Manage billing opens Stripe's portal (B3, B9)", async ({ page, browser, request, baseURL }) => {
    test.setTimeout(180_000);
    expect(customerId, "the first test stored the link's customer").not.toBe("");
    const s = stripe!;
    let b3: string | null = null;
    let b3ReadBack: string | null = null;
    let b9: string | null = null;
    try {
      // ── The subscription Checkout would have made (B13) ──────────────────
      const pm = await s.paymentMethods.attach("pm_card_visa", { customer: customerId });
      const sub = await s.subscriptions.create({
        customer: customerId, default_payment_method: pm.id,
        items: [{ price: priceIds.base, quantity: 1 }, { price: priceIds.voice_minutes }, { price: priceIds.sms }, { price: priceIds.ai_chats }],
        metadata: { bis_account_id: accountId, bis_plan_id: planId },
      });
      subscriptionId = sub.id;
      report("B13 an API subscription on pm_card_visa is active at once", `${sub.status === "active" ? "held" : "NOT held"}: subscription ${sub.id} was created ${sub.status}`, sub.status === "active" ? "notice" : "warning");

      // ── The webhook: forged, signed, replayed ────────────────────────────
      const body = JSON.stringify({
        id: eventId, object: "event", type: "customer.subscription.created", livemode: false,
        api_version: STRIPE_API_VERSION, created: Math.floor(Date.now() / 1000),
        // The payload says "incomplete"; the mirror must ignore it and write
        // what Stripe says when re-read (G5).
        data: { object: { id: sub.id, object: "subscription", status: "incomplete" } },
      });
      const post = (secret: string) => request.post("/api/webhooks/stripe", {
        headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) },
        data: body,
      });
      const forged = await post("whsec_forged");
      expect(forged.status(), "a forged signature is refused").toBe(400);
      const first = await post(WEBHOOK_SECRET);
      expect(first.status()).toBe(200);
      expect(await first.json()).toEqual({ received: true, outcome: "processed" });
      const replay = await post(WEBHOOK_SECRET);
      expect(replay.status()).toBe(200);
      expect(await replay.json(), "a replay of the same event id is recorded once").toEqual({ received: true, outcome: "duplicate" });

      // ── What the mirror wrote ────────────────────────────────────────────
      const db = serviceDb();
      const { data: billed } = await db.from("account_billing")
        .select("subscription_status, stripe_subscription_id, stripe_customer_id, plan_id").eq("account_id", accountId).single();
      expect(billed, "Stripe's word (active), not the payload's (incomplete)").toEqual({
        subscription_status: "active", stripe_subscription_id: sub.id, stripe_customer_id: customerId, plan_id: planId,
      });
      const { data: account } = await db.from("accounts").select("permissions").eq("id", accountId).single();
      expect((account as { permissions: unknown }).permissions, "the plan's features, written (G9)")
        .toEqual({ voice_receptionist: false, web_concierge: true });
      const { data: link } = await db.from("billing_links").select("checkout_session_id").eq("account_id", accountId).maybeSingle();
      expect(link, "the link that led to this subscription is consumed (linkLedTo: same customer, started after it was sent)").toBeNull();
      const { data: events } = await db.from("stripe_webhook_events").select("event_id, processed_at").eq("event_id", eventId);
      expect(events, "one event row, stamped; the forgery recorded nothing").toHaveLength(1);
      expect((events as { processed_at: string | null }[])[0]?.processed_at).not.toBeNull();

      // ── B14, then X1 on the session the subscription left behind ─────────
      const before = (await s.checkout.sessions.retrieve(sessionId)).status;
      report("B14 the link's session stays open after an outside subscription", before === "open"
        ? `held: session ${sessionId} was still open after subscription ${sub.id} was made on its customer`
        : `NOT held: session ${sessionId} was ${String(before)}`, before === "open" ? "notice" : "warning");
      if (before === "open") {
        const expired = await s.checkout.sessions.expire(sessionId);
        expect(expired.status, "an open session expires").toBe("expired");
      }
      let x1: string;
      let x1Level: "notice" | "warning";
      try {
        await s.checkout.sessions.expire(sessionId);
        x1 = `NOT held on an expired session: Stripe accepted expiring ${sessionId} again`;
        x1Level = "warning";
      } catch (e) {
        const type = (e as { type?: unknown }).type;
        x1 = `held on an EXPIRED session: ${errorLine(e)}`;
        // FakeGateway models this refusal as a StripeInvalidRequestError.
        x1Level = type === "StripeInvalidRequestError" ? "notice" : "warning";
      }
      report("X1 Stripe refuses to expire a session that is not open", x1, x1Level);
      report("X1 on a COMPLETED session", "NOT observed: no Stripe API completes a Checkout session (only its hosted page, which this spec does not drive), so the case settleDeadLink relies on is still an assumption", "warning");
      report("X2 an expired session cannot be paid", "NOT observed: it needs a payment held in 3-D Secure on Stripe's hosted page, which this spec does not drive", "warning");

      // ── The agency's card ────────────────────────────────────────────────
      await page.goto(`/dashboard/accounts/${accountId}/settings#billing`);
      await expect(page.locator('#billing [data-status="active"]')).toBeVisible();
      await expect(page.locator("#billing")).toContainText("0 of 100 minutes");

      // ── The client's page, and Manage billing (B3, B9) ───────────────────
      const tagged = await taggedPortalConfigurations(s);
      const client = await browser.newContext({ storageState: "e2e/.auth/client-state.json", baseURL });
      try {
        const cp = await client.newPage();
        await cp.goto(`/dashboard/accounts/${accountId}/billing`);
        await expect(cp.getByText(PLAN_NAME, { exact: true })).toBeVisible();
        await expect(cp.locator('[data-status="active"]')).toBeVisible();
        await expect(cp.getByText("0 of 100 minutes", { exact: true })).toBeVisible();
        await expect(cp.getByText(/^Next invoice /)).toBeVisible();

        const refusal = cp.getByRole("alert").filter({ hasText: m["billing.page.portalFailed"] });
        await cp.getByRole("button", { name: m["billing.page.manage"] }).click();
        // Whichever comes first: Stripe's portal (the redirect worked), or
        // the action's one sentence (the portal session was not made). Each
        // wait resolves, never rejects, so the other can be left behind.
        const landed = await Promise.race([
          cp.waitForURL(/^https:\/\/billing\.stripe\.com\//, { timeout: STRIPE_STEP_MS, waitUntil: "commit" })
            .then(() => "portal" as const, () => "neither" as const),
          refusal.waitFor({ state: "visible", timeout: STRIPE_STEP_MS })
            .then(() => "refused" as const, () => "neither" as const),
        ]);
        if (landed === "refused") {
          b3 = "NOT shown: Manage billing answered its failure sentence, so no portal session was made (the server log names why)";
        } else if (landed === "neither") {
          const still = `within ${STRIPE_STEP_MS / 1000} s the click neither reached billing.stripe.com nor said it failed (still at ${cp.url()})`;
          b3 = `NOT shown: ${still}`;
          b9 = `NOT shown: ${still}`;
        }
        expect(landed, "Manage billing lands on Stripe's portal").toBe("portal");
        b3 = `held: Manage billing made a portal session on BIS's configuration and landed on ${new URL(cp.url()).host}`;
        b9 = "held: the server action's redirect() reached an absolute external URL";
        report("B12 localhost return URLs", "held for the portal: the session was made with return_url on http://localhost:3000", "notice");
      } finally {
        await client.close();
      }

      // ── B3 read-back: the configuration BIS uses, as Stripe holds it ─────
      const want = portalFeatureFlags();
      const after = await taggedPortalConfigurations(s);
      const matches = (c: { features: Record<PortalFeature, boolean> }) => PORTAL_FEATURES.every((f) => c.features[f] === want[f]);
      const madeNow = after.filter((c) => !tagged.some((t) => t.id === c.id));
      // What ensurePortalConfiguration picks: the first tagged one that matches.
      const used = after.find(matches);
      expect(used, `a ${PORTAL_VERSION} configuration reading back EXACTLY ${JSON.stringify(want)}`).toBeDefined();
      for (const c of madeNow) {
        expect(c.features, `configuration ${c.id}, created by this click, reads back as created`).toEqual(want);
      }
      const drifted = after.filter((c) => !matches(c)).map((c) => c.id);
      b3ReadBack = `held: ${used!.id} reads back ${JSON.stringify(used!.features)}; ${madeNow.length === 0 ? "made by an earlier run" : "made by this click"}; ${after.length} tagged ${PORTAL_VERSION}${drifted.length > 0 ? `, DRIFTED (passed over): ${drifted.join(", ")}` : ""}`;
      if (drifted.length > 0) report("B3 drifted portal configurations", `${drifted.join(", ")} tagged ${PORTAL_VERSION} no longer match portalFeatureFlags(); someone changed them in the Stripe dashboard`, "warning");
      passed += 1;
    } finally {
      report("B3 the portal configuration BIS creates is usable", b3 ?? "NOT shown: the test failed before Manage billing was pressed", b3?.startsWith("held") ? "notice" : "warning");
      report("B3 read-back equals portalFeatureFlags()", b3ReadBack ?? "NOT shown: the test failed before the configuration was read back", b3ReadBack ? "notice" : "warning");
      report("B9 a server action redirects to an external URL", b9 ?? "NOT shown: the redirect was not observed (see B3 and the failure above)", b9?.startsWith("held") ? "notice" : "warning");
    }
  });
});
