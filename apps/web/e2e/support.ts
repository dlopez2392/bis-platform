import { type Page, test } from "@playwright/test";

/**
 * The one account seeded in this environment with real data: one contact
 * (Maria Garcia) and one opportunity (Deck build). Specs that need actual
 * rows to assert against should target this account by name rather than
 * grabbing whichever company card renders first on /dashboard/accounts —
 * when stray empty accounts existed alongside it, "first card" landed on
 * an empty company and both the contacts and pipeline specs failed with
 * no table / no opportunity cards to find.
 */
export const SEEDED_ACCOUNT_NAME = "Test Client One";

/**
 * Navigates to /dashboard/accounts and opens the card for `accountName`,
 * found by its accessible name rather than position. If no such card is
 * present — a fresh or reset database, or the seed data being renamed —
 * skips the current test with a clear reason instead of silently falling
 * back to some other account and passing (or failing) against the wrong
 * data.
 */
export async function openAccountByName(page: Page, accountName: string) {
  await page.goto("/dashboard/accounts");
  const card = page.getByRole("link", { name: accountName });
  if ((await card.count()) === 0) {
    test.skip(true, `No account named "${accountName}" found on /dashboard/accounts — seed it before running this spec.`);
    return;
  }
  await card.click();
}
