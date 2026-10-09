import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { readClientFixture } from "./support";
import { m } from "../src/lib/messages";

// Playwright's config passes env to the webServer, not to this process, so the
// service-role credentials have to be loaded explicitly for setup and cleanup.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const ACCOUNT_NAME = "Test Client One";

// Minimal escape for building a RegExp from a message string that may
// contain characters regex treats specially (e.g. a future label with
// parentheses). None of today's labels need it, but the accessible name
// below is assembled from message-table strings, not a literal.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Opening a contact was never covered: the contacts spec asserts the table
// renders and sorts, then stops. A 404 on this route reached the owner.
//
// P4 (Task 5) removed the name-cell link by design: a row click now opens
// the peek drawer, and the full contact page is reached from the drawer's
// "Open full page" link. This test's navigation preamble was updated to
// match; every assertion below it is unchanged.
test("opening a contact from the table renders the detail screen", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toBeVisible();
  // The name cell (2nd <td>, after the checkbox cell) renders an avatar
  // badge before the name, so textContent is e.g. "MGMaria Garcia" — take
  // the trailing name only.
  const nameCell = firstRow.locator("td").nth(1);
  const cellText = (await nameCell.textContent())?.trim() ?? "";
  const name = cellText.replace(/^[A-Z]{1,2}(?=[A-Z][a-z])/, "");
  expect(name.length).toBeGreaterThan(0);

  await firstRow.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("link", { name: m["drawer.openFull"] }).click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

  // The bug this guards against returned 404, which renders not-found.tsx —
  // a page that still "loads". So assert on content only the real detail
  // screen has, and that the not-found copy is absent.
  await expect(page.getByRole("heading", { name })).toBeVisible();
  // The Email value is an InlineField in DISPLAY mode here — a <button>
  // whose accessible name is "Edit Email: <value>", not a labelled input
  // (it only gets a plain "Email" label once clicked into edit mode). So
  // getByLabel("Email") never matched this field at all; before the
  // contact page grew a "No marketing emails" checkbox it happened to
  // match THAT checkbox's label by substring ("emails" contains "email"),
  // which read as passing. Built from the same message keys the component
  // uses, so a copy change to either stays in sync automatically.
  const emailEditName = new RegExp(
    "^" + escapeRegExp(m["inline.edit"].replace("{label}", m["contacts.email"])) + ":",
  );
  await expect(page.getByRole("button", { name: emailEditName })).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);
});

/**
 * A sent email must appear on the record it was sent FROM.
 *
 * Until this, `ActivityTimeline` had no message kind at all: an operator
 * emailed a customer from the contact page, got a success toast, and the
 * contact's own history showed nothing. The message existed only in
 * Conversations, which is not where anyone looks for "what have we said to
 * this person".
 *
 * Asserted against the timeline's rendered text, not the composer's — the
 * composer is where the words were typed, so finding them there proves
 * nothing about the record.
 */
test("an email sent from a contact appears on that contact's timeline", async ({ page }) => {
  // On the per-run fixture account, never Test Client One (CLAUDE.md): a send
  // writes a conversation and a message. This test used to send from Maria
  // Garcia on the seeded account and never cleaned up, so every run added
  // another email to a live record. It now sends from a contact of its own,
  // with an email address (the send guard requires one), deleted afterwards
  // in FK order; a run that dies first strands it only until auth.teardown.ts
  // deletes the whole fixture account.
  const fixture = readClientFixture();
  test.skip(!fixture, "client fixture file missing — run through the setup project");
  const accountId = fixture!.accountId;
  const stamp = Date.now();
  const db = serviceDb();
  const { id: contactId } = await createContact(db, accountId, {
    firstName: "Timeline", lastName: `Check ${stamp}`, email: `e2e-timeline-${stamp}@example.com`,
  }, "e2e-contact-detail");

  try {
    await page.goto(`/dashboard/accounts/${accountId}/contacts/${contactId}`);

    // Must not share words with the contact's name ("Timeline Check <stamp>",
    // the page heading): getByText ignores case, so it matched both.
    const body = `Hello from the e2e send ${stamp}`;
    // The composer has no <label>s — it is a mode toggle plus placeholders.
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByPlaceholder("Subject").fill("Timeline check");
    await page.getByPlaceholder(/write an email/i).fill(body);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The timeline, not the composer. Outside production the provider is the
    // fake one, so this proves the record — not delivery. The unique body is
    // the real assertion; before this change "Email sent" matched nothing at
    // all on the timeline.
    await expect(page.getByText("Email sent").first()).toBeVisible();
    await expect(page.getByText(body)).toBeVisible();
  } finally {
    await deleteContactAndThread(accountId, contactId);
  }
});

/** This test's own contact and anything its send created, in FK order. */
async function deleteContactAndThread(accountId: string, contactId: string): Promise<void> {
  const db = serviceDb();
  const { data: convos } = await db.from("conversations").select("id")
    .eq("account_id", accountId).eq("contact_id", contactId);
  for (const convo of convos ?? []) {
    await db.from("messages").delete().eq("conversation_id", convo.id);
    await db.from("conversations").delete().eq("id", convo.id);
  }
  const { error } = await db.from("contacts").delete().eq("id", contactId);
  if (error) console.error(`contact-detail e2e: cleanup failed: ${error.message}`);
}
