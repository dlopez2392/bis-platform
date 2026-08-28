import { type Page, test } from "@playwright/test";
import { contrastRatio } from "../src/lib/branding/color";

/**
 * `rgb(30, 58, 138)` — what getComputedStyle reports — back to `#1e3a8a`, so
 * a painted colour can be measured rather than only compared to a literal.
 *
 * This exists because M4b made the exact value a tenant's Submit button wears
 * a DERIVED one: it is lifted for the tenant's own surfaces, so pinning a hex
 * in a spec would either duplicate the derivation or freeze whichever answer
 * it happened to give. The property worth asserting is that it stays legible.
 */
export function hexOf(cssColor: string): string {
  const [r, g, b] = cssColor.match(/\d+/g)!.map(Number) as [number, number, number];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The contrast ratio between two colours as getComputedStyle reports them. */
export function paintedContrast(a: string, b: string): number {
  return contrastRatio(hexOf(a), hexOf(b));
}

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
 * The seeded contact on that account, and the only one guaranteed to carry an
 * EMAIL ADDRESS — which the composer's email mode requires (with none on file
 * it renders "no email on this contact" and never shows a Subject field).
 *
 * Named rather than taken positionally. `listContacts` orders by `created_at`
 * descending, so `.first()` means "whoever rang most recently" — and real
 * voice calls have since created contacts on this shared account from nothing
 * but a phone number, with `email` null. That is exactly the positional-
 * locator trap `openAccountByName` above was written for, one level down:
 * `.first()` was only ever the seeded contact by accident of it being the
 * only one.
 */
export const SEEDED_CONTACT_NAME = "Maria Garcia";

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
