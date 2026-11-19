import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, listMySubscriptions, unsubscribeFromBrief } from "@bis/db";
import { readClientFixture } from "./support";

// The Undo of ONE named toast. By the second Undo three or four toasts are stacked, and sonner re-lays the stack
// while a new one slides in, so a pointer click on the front Undo was intercepted by its neighbour until the test
// timed out (CI, #389 and #395, 2026-11-18/19). The toast is found by its own words and its button is clicked
// directly: this spec proves the Undo ACTION, not the stack's animation.
async function undoOn(page: Page, toastText: string) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: toastText }).first();
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).dispatchEvent("click");
}

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * F-082 PR 4: the daily brief's switch on Mis preferencias, end to end, on the PER-RUN FIXTURE account's own Owner,
 * never Test Client One (the switch writes a subscription row that sends real mail once the pass runs). Through the
 * UI: on, the row's words change and a row exists in the table; off, it is gone; Undo after each puts it back. The
 * table is read through the app's own data layer, so the assertion is on what the pass would see, not only on pixels.
 * Cleanup deletes the Owner's row so the next run starts off, and so a brief can never be sent for a fixture.
 */
test.describe.configure({ timeout: 60_000 });

let accountId = "";
let userId = "";

async function mySubs() {
  return (await listMySubscriptions(serviceDb(), userId)).filter((s) => s.accountId === accountId);
}

test.describe.serial("daily brief switch (F-082 PR 4)", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test.beforeAll(async () => {
    const fx = readClientFixture();
    if (!fx) throw new Error("client fixture missing: the setup project did not run. Run the full suite: pnpm --filter web test:e2e.");
    accountId = fx.accountId;
    const owner = await serviceDb().from("memberships").select("user_id")
      .eq("scope", "account").eq("account_id", accountId).eq("role", "owner").limit(1).single();
    if (owner.error) throw new Error(`daily-brief e2e: could not read the fixture Owner: ${owner.error.message}`);
    userId = (owner.data as { user_id: string }).user_id;
    await unsubscribeFromBrief(serviceDb(), { userId, accountId });
  });

  test.afterAll(async () => {
    await unsubscribeFromBrief(serviceDb(), { userId, accountId });
  });

  test("a row for the business, off to start; on says when it comes; off removes the subscription; Undo brings each back", async ({ page }) => {
    await page.goto("/dashboard/preferences");
    const row = page.locator(`[data-daily-brief-row="${accountId}"]`);
    const sw = row.getByRole("switch");
    await expect(row).toBeVisible();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(row.locator("[data-daily-brief-status]")).toHaveText("Off");

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(row).toContainText("Arrives at 7 AM, your time.");
    await expect(row).toContainText("First one tomorrow.");
    await expect.poll(async () => (await mySubs()).length).toBe(1);

    // Undo of the ON removes it again.
    await undoOn(page, "Daily brief on for");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await mySubs()).length).toBe(0);

    // On again, then off from the switch; Undo of the OFF restores it.
    await sw.click();
    await expect.poll(async () => (await mySubs()).length).toBe(1);
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await mySubs()).length).toBe(0);
    await undoOn(page, "Daily brief off for");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await mySubs()).length).toBe(1);

    // The choice survives a reload (the server is the source of truth, not the optimistic state).
    await page.reload();
    await expect(page.locator(`[data-daily-brief-row="${accountId}"]`).getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  test("the switch is reachable and operable by keyboard", async ({ page }) => {
    await page.goto("/dashboard/preferences");
    const sw = page.locator(`[data-daily-brief-row="${accountId}"]`).getByRole("switch");
    await sw.focus();
    await expect(sw).toBeFocused();
    await page.keyboard.press("Space");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await mySubs()).length).toBe(0);
  });
});
