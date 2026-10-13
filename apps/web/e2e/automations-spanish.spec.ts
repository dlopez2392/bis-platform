import { test, expect } from "./fixtures/test";
import { readFileSync } from "node:fs";
import { serviceDb, getAutomation, upsertAutomation, getBranding, brandDisplayName } from "@bis/db";
import { m } from "../src/lib/messages";

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = (): ClientFixture =>
  JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

/**
 * S-09 PR 2 (Task 22). The agency-only automations page's review-request
 * card, on the per-run fixture account (never Test Client One: this test
 * MUTATES the account's review_request row). Runs on the default `chromium`
 * project, whose storage state is the agency session `setup` produces.
 *
 * NULL body_es = our written Spanish default (shown pre-filled); editing the
 * English only leaves body_es_basis stale against the new English, which the
 * card flags; emptying the Spanish box shows the "customers get English"
 * line and offers "Use our Spanish" to refill it. Every assertion compares
 * against the literal catalogue string (never `t()`'s fallback), so a
 * missing Spanish twin would fail this test, not silently pass it.
 */
test.describe("S-09 PR 2: the review card's Spanish box (fixture account only)", () => {
  test("opens with our Spanish; an English-only edit warns; emptied says so; Use our Spanish refills", async ({ page }) => {
    const { accountId, clerkUserId } = fixture();
    const db = serviceDb();
    const before = await getAutomation(db, accountId, "review_request");
    const brand = brandDisplayName(await getBranding(db, accountId));
    const ours = m["automations.review.defaultBody.es"].replace("{name}", brand);

    try {
      // Seed a known starting row: English body set, Spanish box untouched
      // (NULL body_es / NULL basis) so the card opens pre-filled with ours.
      await upsertAutomation(
        db, accountId, "review_request",
        {
          enabled: false,
          body: "Thanks for having us out!",
          config: { channel: "email", reviewUrl: "https://example.com/r" },
          bodyEs: null, bodyEsBasis: null,
        },
        clerkUserId,
      );

      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("review-request-card");
      const es = card.locator('textarea[name="body_es"]');

      // Pre-filled with our Spanish default (NULL body_es).
      await expect(es).toHaveValue(ours);

      // An English-only edit, saved, leaves the Spanish row's basis stale
      // against the new English.
      await card.locator('textarea[name="body"]').fill("Thanks for having us out, it means a lot.");
      await card.getByRole("button", { name: m["automations.review.save"] }).click();
      await expect(page.getByText(m["automations.review.saved"])).toBeVisible();
      await page.reload();
      await expect(card.getByText(m["automations.bodyEs.stale"])).toBeVisible();

      // Emptying the Spanish box (without saving) shows the live "customers
      // get English" line and the refill action.
      const esAfterReload = card.locator('textarea[name="body_es"]');
      await esAfterReload.fill("");
      await expect(card.getByText(m["automations.bodyEs.emptied"])).toBeVisible();
      await card.getByRole("button", { name: m["automations.bodyEs.useOurs"] }).click();
      await expect(esAfterReload).toHaveValue(ours);
    } finally {
      const restore = before
        ? upsertAutomation(
            db, accountId, "review_request",
            {
              enabled: before.enabled, body: before.body,
              config: before.config as Record<string, unknown>,
              bodyEs: before.body_es, bodyEsBasis: before.body_es_basis,
            },
            clerkUserId,
          )
        : db.from("automations").delete().eq("account_id", accountId).eq("recipe_key", "review_request")
            .then(({ error }) => { if (error) throw error; });
      await Promise.resolve(restore).catch((e: unknown) =>
        console.error(`automations-spanish e2e: restore failed: ${String(e)}`));
    }
  });
});
