import { test, expect } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { SEEDED_CONTACT_NAME } from "./support";

// Playwright's config passes env to the webServer, not to this process, so the
// service-role credentials have to be loaded explicitly for cleanup.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// Pinned by name, not position — same reasoning as contact-detail.spec.ts:
// "first card" on /dashboard/accounts broke once stray accounts existed
// alongside the seeded one. This spec needs Test Client One specifically
// because that's the account whose contact (Maria Garcia) has an email
// address, which the send guard requires.
const ACCOUNT_NAME = "Test Client One";

// SEEDED_CONTACT_NAME (support.ts): ...and the contact on it that actually
// has that email address. Named rather than taken positionally: `listContacts`
// orders by `created_at` descending, so `.first()` means "whoever rang most
// recently", and real voice calls have since created contacts on this shared
// account from a phone number alone, with `email` null. The composer
// correctly refuses to email those — it renders "no email on this contact"
// instead of a Subject field — so `.first()` had quietly stopped selecting a
// contact this spec can send from.

test("email sent from a contact appears in the thread and in Conversations", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  await page.getByRole("table").getByRole("link", { name: SEEDED_CONTACT_NAME }).click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

  // This spec writes real rows to the shared dev database. `ensureConversation`
  // is unique per (account, contact), so runs reuse one thread and it is the
  // *messages* that accumulate — those are deleted at the end of this test.
  // The timestamped subject both scopes that cleanup and stops assertions
  // from matching a row a crashed earlier run left behind.
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
  // The screen no longer auto-opens the newest thread — doing so marked a fresh
  // inbound lead read before anyone looked at it — so a thread has to be picked.
  // Picked by WHOSE it is, now that this spec walks in through a named contact
  // rather than "the first row in the table": voice calls have since opened
  // conversations of their own on this account, so "the first thread" is a
  // position in a list this spec never asserts the order of.
  await page.locator("a[href*='?c=']").filter({ hasText: SEEDED_CONTACT_NAME }).first().click();
  await expect(page.getByText(subject).first()).toBeVisible();
  await expect(page.getByText("Sent").first()).toBeVisible();
  await expect(page.getByText("Sent by the e2e suite.").first()).toBeVisible();

  // Delete only the rows this run created, matched by its unique subject.
  // Nothing else is touched — the seeded account, contact and opportunity
  // must survive, and the conversation row is shared with future runs.
  const { error } = await serviceDb().from("messages").delete().eq("subject", subject);
  expect(error, `cleanup failed: ${error?.message}`).toBeNull();
});
