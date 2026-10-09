import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { readClientFixture } from "./support";
import { m } from "../src/lib/messages";

// Playwright's config passes env to the webServer, not to this process, so the
// service-role credentials have to be loaded explicitly for setup and cleanup.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// On the per-run fixture account, never Test Client One (CLAUDE.md): a send
// writes a conversation and a message. This spec used to send from Maria
// Garcia on the seeded account, the one contact there with an email address
// (which the send guard requires); it deleted its message but left the
// conversation behind on a live record. It now sends from a contact of its
// own, with an email address, and deletes the contact, its conversation and
// its messages afterwards, in FK order. A run that dies first strands them
// only until auth.teardown.ts deletes the whole fixture account.
test("email sent from a contact appears in the thread and in Conversations", async ({ page }) => {
  const fixture = readClientFixture();
  test.skip(!fixture, "client fixture file missing — run through the setup project");
  const accountId = fixture!.accountId;
  const stamp = Date.now();
  // A full name, so the Conversations list shows it rather than the address
  // and the thread can be picked by whose it is.
  const contactName = `Mail Check ${stamp}`;
  const db = serviceDb();
  const { id: contactId } = await createContact(db, accountId, {
    firstName: "Mail", lastName: `Check ${stamp}`, email: `e2e-messaging-${stamp}@example.com`,
  }, "e2e-messaging");

  try {
    await sendAndFindInConversations(page, accountId, contactId, contactName, stamp);
  } finally {
    const { data: convos } = await db.from("conversations").select("id")
      .eq("account_id", accountId).eq("contact_id", contactId);
    for (const convo of convos ?? []) {
      await db.from("messages").delete().eq("conversation_id", convo.id);
      await db.from("conversations").delete().eq("id", convo.id);
    }
    const { error } = await db.from("contacts").delete().eq("id", contactId);
    expect(error, `cleanup failed: ${error?.message}`).toBeNull();
  }
});

async function sendAndFindInConversations(
  page: Page, accountId: string, contactId: string, contactName: string, stamp: number,
): Promise<void> {
  // Opened through the list and the peek drawer, the way an operator gets
  // there: P4 (Task 5) removed the name-cell link, so a row click opens the
  // drawer and the full page is reached from its "Open full page" link.
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${stamp}`);
  await page.getByRole("row").filter({ hasText: contactName }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: m["drawer.openFull"] }).click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${contactId}$`));

  // The timestamped subject stops assertions from matching a row a crashed
  // earlier run left behind. (Kept as `Date.now()` literally: the template is
  // listed by its source text in fixtures/fixture-names.test.ts.)
  const subject = `E2E ${Date.now()}`;
  // `exact` matters since P4 Task 8: the fields panel's inline-edit control
  // for the email field is a button named "Edit Email", which a substring
  // match also picks up. The composer tab is exactly "Email".
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.getByPlaceholder("Subject").fill(subject);
  await page.getByPlaceholder("Write an email…").fill("Sent by the e2e suite.");

  // The composer disables its own button for the duration of the send. This is
  // the ONE assertion standing between a slow Resend round-trip and a
  // DUPLICATE EMAIL to a real person — send-button.tsx exists for it, and
  // after the move off the `action` prop its pending state is passed by hand
  // rather than read from useFormStatus, so a wiring mistake would be silent.
  const send = page.getByRole("button", { name: "Send" });
  await send.click();
  await expect(send).toBeDisabled();
  // …and released again once the send settles, or the operator could never
  // send a second message without reloading.
  await expect(send).toBeEnabled({ timeout: 20_000 });

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
  // Picked by WHOSE it is: other specs open conversations on this account too,
  // so "the first thread" is a position in a list this spec never asserts the
  // order of.
  await page.locator("a[href*='?c=']").filter({ hasText: contactName }).first().click();
  await expect(page.getByText(subject).first()).toBeVisible();
  await expect(page.getByText("Sent").first()).toBeVisible();
  await expect(page.getByText("Sent by the e2e suite.").first()).toBeVisible();
}
