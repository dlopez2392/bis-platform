import { test, expect } from "@playwright/test";
import { SEEDED_CONTACT_NAME } from "./support";
import { m } from "../src/lib/messages";

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
  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  // By name, not by position — see SEEDED_CONTACT_NAME above. This test needs
  // a contact the app is willing to email. P4 (Task 5) removed the name-cell
  // link: the row opens the peek drawer, and the full page is reached from
  // its "Open full page" link.
  await page.getByRole("row").filter({ hasText: SEEDED_CONTACT_NAME }).click();
  const openDialog = page.getByRole("dialog");
  await expect(openDialog).toBeVisible();
  await openDialog.getByRole("link", { name: m["drawer.openFull"] }).click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

  const body = `Timeline check ${Date.now()}`;
  // The composer has no <label>s — it is a mode toggle plus placeholders.
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.getByPlaceholder("Subject").fill("Timeline check");
  await page.getByPlaceholder(/write an email/i).fill(body);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // The timeline, not the composer. Outside production the provider is the
  // fake one, so this proves the record — not delivery.
  // The unique body is the real assertion; "Email sent" is deliberately
  // .first() because this contact has a long history of them — which is the
  // point. Before this change that label matched nothing at all.
  await expect(page.getByText("Email sent").first()).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();
});
