import { test, expect } from "@playwright/test";

// Pinned by name, not position — same reasoning as contact-detail.spec.ts:
// "first card" on /dashboard/accounts broke once stray accounts existed
// alongside the seeded one. This spec needs Test Client One specifically
// because that's the account whose contact (Maria Garcia) has an email
// address, which the send guard requires.
const ACCOUNT_NAME = "Test Client One";

test("email sent from a contact appears in the thread and in Conversations", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  await page.getByRole("table").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

  // This spec writes a real conversation + message row to the shared dev
  // database and does not clean up after itself (there is no delete path
  // in this milestone). A timestamp-based subject keeps it from colliding
  // with rows a previous run left behind — without it, `getByText(subject)`
  // could match a stale row instead of (or in addition to) this run's.
  const subject = `E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Email" }).click();
  await page.getByPlaceholder("Subject").fill(subject);
  await page.getByPlaceholder("Write an email…").fill("Sent by the e2e suite.");
  await page.getByRole("button", { name: "Send" }).click();

  // The contact page's ActivityTimeline (contacts/[contactId]/activity-timeline.tsx)
  // only ever renders notes/tasks/opportunities — its TimelineItem union has no
  // "message" case, and the page never fetches messages — so a sent email gives
  // no on-page confirmation here beyond the composer's error-only toast. That
  // matches Task 3's own verification note ("the message appears in the
  // thread with status"): "the thread" is the Conversations MessageThread, not
  // this page. Confirmed live: asserting the subject/status here fails even
  // though the send genuinely succeeded (see task-6-report.md). So the fake
  // provider is active outside production, and nothing is delivered — but the
  // full pipeline runs and the row must land as sent — proven on the one
  // screen that actually surfaces it.
  await page.getByRole("link", { name: "Conversations" }).click();
  await expect(page).toHaveURL(/\/conversations/);
  await expect(page.getByText(subject).first()).toBeVisible();
  await expect(page.getByText("Sent").first()).toBeVisible();
  await expect(page.getByText("Sent by the e2e suite.").first()).toBeVisible();
});
