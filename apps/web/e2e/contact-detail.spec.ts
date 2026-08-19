import { test, expect } from "@playwright/test";

const ACCOUNT_NAME = "Test Client One";

// Opening a contact was never covered: the contacts spec asserts the table
// renders and sorts, then stops. A 404 on this route reached the owner.
test("opening a contact from the table renders the detail screen", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  const firstContact = page.getByRole("table").getByRole("link").first();
  await expect(firstContact).toBeVisible();
  // The cell renders an avatar badge before the name, so textContent is
  // e.g. "MGMaria Garcia" — take the trailing name only.
  const cellText = (await firstContact.textContent())?.trim() ?? "";
  const name = cellText.replace(/^[A-Z]{1,2}(?=[A-Z][a-z])/, "");
  expect(name.length).toBeGreaterThan(0);

  await firstContact.click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

  // The bug this guards against returned 404, which renders not-found.tsx —
  // a page that still "loads". So assert on content only the real detail
  // screen has, and that the not-found copy is absent.
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
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
  await page.getByRole("table").getByRole("link").first().click();
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
