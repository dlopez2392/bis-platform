import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import { serviceDb, type StripePriceIds } from "@bis/db";
import { m } from "../src/lib/messages";

// This file reads and writes `plans` directly from the Playwright runner
// (never through a Next.js request), with the same two dotenv lines
// numbers.spec.ts uses.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// The agency Plans page (/dashboard/plans), client billing rollout step 1.
//
// A boundary test first, then the one thing only a real Stripe can prove:
// that Save leaves a product, a licensed monthly price and three GRADUATED
// metered prices on the right meters in Stripe TEST mode, and that an edit
// adds only the price that changed.
//
// `plans` is AGENCY-scoped: withTestAccount-style isolation does not exist
// for it. Every plan here carries this run's stamp and is deleted by the
// test that made it (its Stripe product is deactivated, since Stripe
// refuses to delete a product that has prices).
//
// STRIPE TEST MODE ONLY. CI's target guard refuses a live key before any
// step runs, and this file re-checks the prefix before its first call.
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const NO_STRIPE =
  "STRIPE_SECRET_KEY is not set, so the Stripe half of the Plans page was NOT tested. Add the Stripe TEST secret key (sk_test_) as the repository secret CI_STRIPE_SECRET_KEY, or to apps/web/.env.local locally.";
// A real Date.now() stamp (13 digits), not the base36 random RUN this file
// used to carry: the sweep (fixtures/stale.ts, FIXTURE_PLAN_RE) tells a
// stale leftover from a concurrent run's live row by reading this stamp back
// out of the name, exactly as every other fixture shape does.
const RUN = Date.now();
const PLAN_NAME = `E2E Plan ${RUN}`;

test.describe("a client cannot reach the Plans page", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client lands on its own dashboard, and a plan's name never reaches its browser", async ({ page }) => {
    const fixture = JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as { accountId: string };
    // A canary plan written straight to the table (no Stripe needed: the
    // database checks only the ids' shape), so the leak check has something
    // to leak.
    const db = serviceDb();
    const { data: agency, error: agencyError } = await db.from("agencies").select("id").limit(1).single();
    if (agencyError || !agency) throw new Error(`plans.spec canary: agencies select failed: ${agencyError?.message ?? "no row"}`);
    const canary = `E2E Canary ${RUN}`;
    const { data: row, error } = await db.from("plans").insert({
      agency_id: (agency as { id: string }).id, name: canary, monthly_price_cents: 4900,
      features: { voice_receptionist: false, web_concierge: false },
      allowances: { voice_minutes: 0, sms: 0, ai_chats: 0 },
      overage_cents: { voice_minutes: 0, sms: 0, ai_chats: 0 },
      stripe_product_id: "prod_e2e_canary",
      stripe_price_ids: { base: "price_e2e_b", voice_minutes: "price_e2e_v", sms: "price_e2e_s", ai_chats: "price_e2e_a" },
    }).select("id").single();
    expect(error).toBeNull();
    let bodyOk = false;
    try {
      await page.goto("/dashboard/plans");
      await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard(?:[/?]|$)`));
      await expect(page.getByText(canary)).toHaveCount(0);
      bodyOk = true;
    } finally {
      // Thrown only when the body passed: a throw from finally would REPLACE
      // the primary failure (packages/db/src/test/billing.test.ts's withPlans).
      const { error: cleanupError } = await db.from("plans").delete().eq("id", (row as { id: string }).id);
      if (cleanupError) {
        const msg = `plans.spec canary cleanup failed on plans: ${cleanupError.message}`;
        if (bodyOk) throw new Error(msg);
        console.error(msg);
      }
    }
  });
});

test.describe("the agency's plan becomes Stripe prices", () => {
  let planId: string | null = null;
  let productId: string | null = null;
  // Set as the test's LAST line, so afterAll can tell a cleanup failure after
  // a green test (thrown) from one after a red test (logged, never masking it).
  let bodyOk = false;

  test.afterAll(async () => {
    let cleanupError: string | null = null;
    if (planId) {
      const { error } = await serviceDb().from("plans").delete().eq("id", planId);
      if (error) cleanupError = `plans.spec cleanup failed on plans (${planId}): ${error.message}`;
    }
    if (productId && /^(sk|rk)_test_/.test(STRIPE_KEY)) {
      await new Stripe(STRIPE_KEY).products.update(productId, { active: false });
    }
    if (cleanupError) {
      if (bodyOk) throw new Error(cleanupError);
      console.error(cleanupError);
    }
  });

  test("Save makes a product, a monthly price and three graduated metered prices; an edit adds only the new price; archive undoes", async ({ page }) => {
    if (!STRIPE_KEY) console.warn(`::warning title=plans.spec.ts skipped::${NO_STRIPE}`);
    test.skip(!STRIPE_KEY, NO_STRIPE);
    expect(/^(sk|rk)_test_/.test(STRIPE_KEY), "plans.spec.ts runs on a Stripe TEST key only").toBe(true);
    test.setTimeout(120_000);
    const stripe = new Stripe(STRIPE_KEY);

    // --- Create through the UI --------------------------------------------
    await page.goto("/dashboard/plans");
    await page.getByRole("button", { name: m["plans.new"], exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(m["plans.field.name"]).fill(PLAN_NAME);
    await dialog.getByLabel(m["plans.field.monthlyPrice"]).fill("49");
    await dialog.getByLabel(m["plans.field.allowance.voice_minutes"]).fill("300");
    await dialog.getByLabel(m["plans.field.overage.voice_minutes"]).fill("0.12");
    await dialog.getByLabel(m["plans.field.allowance.sms"]).fill("1000");
    await dialog.getByLabel(m["plans.field.overage.sms"]).fill("0.03");
    await dialog.getByLabel(m["plans.field.allowance.ai_chats"]).fill("0");
    await dialog.getByLabel(m["plans.field.overage.ai_chats"]).fill("0.25");
    await dialog.getByLabel(m["plans.feature.voice_receptionist"]).check();
    await dialog.getByRole("button", { name: m["plans.save"] }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const row = page.locator("[data-plan-row]").filter({ hasText: PLAN_NAME });
    await expect(row).toContainText(m["plans.status.active"]);
    await expect(row).toContainText("$49.00/month");
    await expect(row).toContainText(m["plans.feature.voice_receptionist"]); // assumption A3
    await expect(row).not.toContainText(m["plans.feature.web_concierge"]);

    // --- The row, read back ------------------------------------------------
    const { data, error } = await serviceDb().from("plans")
      .select("id, monthly_price_cents, features, allowances, overage_cents, stripe_product_id, stripe_price_ids")
      .eq("name", PLAN_NAME).single();
    expect(error).toBeNull();
    planId = (data as { id: string }).id;
    productId = (data as { stripe_product_id: string }).stripe_product_id;
    expect(data).toMatchObject({
      monthly_price_cents: 4900,
      features: { voice_receptionist: true, web_concierge: false },
      allowances: { voice_minutes: 300, sms: 1000, ai_chats: 0 },
      overage_cents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
    });
    const ids = (data as { stripe_price_ids: StripePriceIds }).stripe_price_ids;

    // --- Stripe, read back -------------------------------------------------
    // Re-fetch once and check both the plan-id link AND the name Save just
    // sent — the product name is re-asserted on EVERY save (see
    // stripe-catalog.ts's syncPlanToStripe), so it has to be right immediately
    // after create too, not just survive an edit untouched.
    const product = await stripe.products.retrieve(productId);
    expect(product.metadata.bis_plan_id).toBe(planId);
    expect(product.name).toBe(PLAN_NAME);
    const base = await stripe.prices.retrieve(ids.base);
    expect([base.product, base.unit_amount, base.currency, base.recurring?.interval, base.recurring?.usage_type])
      .toEqual([productId, 4900, "usd", "month", "licensed"]);

    for (const [key, allowance, overage, eventName] of [
      ["voice_minutes", 300, 12, "bis_voice_minutes"],
      ["sms", 1000, 3, "bis_sms_segments"],
    ] as const) {
      const price = await stripe.prices.retrieve(ids[key], { expand: ["tiers"] }); // assumption A2
      expect([price.billing_scheme, price.tiers_mode, price.recurring?.usage_type]).toEqual(["tiered", "graduated", "metered"]);
      expect(price.tiers?.map((t) => [t.up_to, t.unit_amount])).toEqual([[allowance, 0], [null, overage]]); // assumption A1
      expect((await stripe.billing.meters.retrieve(price.recurring!.meter!)).event_name).toBe(eventName);
    }
    const chats = await stripe.prices.retrieve(ids.ai_chats);
    expect([chats.billing_scheme, chats.unit_amount, chats.recurring?.usage_type]).toEqual(["per_unit", 25, "metered"]);
    expect((await stripe.billing.meters.retrieve(chats.recurring!.meter!)).event_name).toBe("bis_ai_chats");

    // --- Edit the monthly price only ---------------------------------------
    await row.getByRole("button", { name: m["plans.editLabel"].replace("{name}", PLAN_NAME) }).click();
    const edit = page.getByRole("dialog");
    await edit.getByLabel(m["plans.field.monthlyPrice"]).fill("59");
    await edit.getByRole("button", { name: m["plans.save"] }).click();
    await expect(edit).toBeHidden({ timeout: 30_000 });
    await expect(row).toContainText("$59.00/month");
    const { data: after } = await serviceDb().from("plans").select("stripe_product_id, stripe_price_ids").eq("id", planId).single();
    const afterIds = (after as { stripe_price_ids: StripePriceIds }).stripe_price_ids;
    expect((after as { stripe_product_id: string }).stripe_product_id).toBe(productId);
    expect(afterIds.base).not.toBe(ids.base);
    expect([afterIds.voice_minutes, afterIds.sms, afterIds.ai_chats]).toEqual([ids.voice_minutes, ids.sms, ids.ai_chats]);
    expect((await stripe.prices.retrieve(afterIds.base)).unit_amount).toBe(5900);
    // The edit left the product's name as it was. This cannot observe
    // syncPlanToStripe's re-assertion of the name on every save (the name
    // is unchanged, so a save that skipped the rename looks identical here);
    // the unit tests in stripe-catalog.test.ts pin that call.
    expect((await stripe.products.retrieve(productId)).name).toBe(PLAN_NAME);

    // --- Archive, then Undo (DESIGN.md rule 6) -----------------------------
    await row.getByRole("button", { name: m["plans.archiveLabel"].replace("{name}", PLAN_NAME) }).click();
    await expect(row).toContainText(m["plans.status.archived"]);
    await page.getByRole("button", { name: m["common.undo"] }).click();
    await expect(row).toContainText(m["plans.status.active"]);
    bodyOk = true;
  });
});
