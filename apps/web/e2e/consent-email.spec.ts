import { test, expect, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { sealConsentToken } from "../src/lib/consent/token";
import { m } from "../src/lib/messages";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Consent chain PR-3 end to end (spec §8's two email lines, plan G16), ON
 * THE PER-RUN FIXTURE ACCOUNT ONLY (never Test Client One, CLAUDE.md):
 *   1. /u/<token>: (decision Q1) the question and one "Stop emails"; the
 *      press records the stop and moves focus to Resubscribe; the drawer's
 *      Email row says "unsubscribe link" and offers no Resume; Resubscribe
 *      lifts it;
 *   2. the RFC 8058 one-click POST, sent the way a mail client sends it —
 *      no cookies, no session (review R2-I6): 200, empty, no cookie, no
 *      redirect; a bad
 *      token 400; the GET redirects to the page;
 *   3. staff Stop emails with Undo, and Resume with a required note;
 *   4. the email composer's notice after an unsubscribe, the form still there.
 * Its own contacts, deleted in afterAll; the ledger rows stay (append-only,
 * contact_id null for the customer's own rows) until the fixture account is
 * swept.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

type ClientFixture = { accountId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE} — run the full suite`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};

const ACTOR = "e2e-consent-email";
const STAMP = Date.now().toString();
const made: { contacts: string[]; brand: string | null } = { contacts: [], brand: null };
const address = (who: string) => `e2e-${who}-${STAMP}@example.com`;
const SECRET = process.env.CONSENT_TOKEN_SECRET ?? "";
const tokenFor = (contactId: string, who: string) => sealConsentToken({
  v: 1, a: fixture().accountId, c: "email", t: address(who), i: Date.now(), n: contactId, k: "automation.reminder",
}, SECRET);

test.beforeAll(async () => {
  if (!SECRET) {
    const why = "CONSENT_TOKEN_SECRET is not set for this run (ci.yml's e2e job sets a fixture literal)";
    console.warn(`::warning title=consent-email.spec.ts skipped::${why}`);
    test.skip(true, why);
  }
  const { accountId } = fixture();
  const db = serviceDb();
  for (const who of ["page", "click", "staff", "composer"]) {
    made.contacts.push((await createContact(db, accountId, { firstName: who, lastName: STAMP, email: address(who) }, ACTOR)).id);
  }
  const { data } = await db.from("accounts").select("brand_name").eq("id", accountId).single();
  made.brand = (data as { brand_name: string | null } | null)?.brand_name ?? null;
});

test.afterAll(async () => {
  const db = serviceDb();
  for (const id of made.contacts) {
    const { error } = await db.from("contacts").delete().eq("id", id);
    if (error) console.error(`consent-email e2e: contact cleanup failed (the fixture sweep takes it): ${error.message}`);
  }
});

/** The newest deciding email row for an address, read as the service role. */
async function newestEmailRow(who: string): Promise<{ action: string; method: string } | null> {
  const { data, error } = await serviceDb().from("consent_events")
    .select("action, method, occurred_at, id")
    .eq("account_id", fixture().accountId).eq("channel", "email").eq("address", address(who))
    .in("action", ["revoked", "held", "hold_released", "resubscribed"])
    .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const r = data?.[0] as { action: string; method: string } | undefined;
  return r ? { action: r.action, method: r.method } : null;
}

async function openEmailRow(page: import("@playwright/test").Page, who: string) {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `${who} ${STAMP}` }).first().click();
  return page.getByRole("dialog").getByTestId("email-row");
}

test("the unsubscribe link: the question, one click records it, the drawer says so, and Resubscribe lifts it", async ({ page, browser }) => {
  const token = tokenFor(made.contacts[0]!, "page");
  // A fresh context: the page is public, and a customer is never signed in.
  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cpage = await customer.newPage();
  await cpage.goto(`/u/${token}`);
  const section = cpage.getByTestId("unsubscribe");
  await expect(section).toHaveAttribute("data-state", "ask");                                       // decision Q1
  await expect(section).toContainText(`Stop emails from ${made.brand}?`);
  await expect(section).toContainText(`¿Dejar de recibir correos de ${made.brand}?`);
  expect(await newestEmailRow("page")).toBeNull();                                                   // nothing on GET (decision Q1)
  await expect(cpage.getByRole("button", { name: m["unsubscribe.button"] })).toHaveText("Stop emails / Dejar de recibir correos"); // decision P2
  await cpage.getByRole("button", { name: m["unsubscribe.button"] }).click();
  await expect(section).toHaveAttribute("data-state", "stopped");
  await expect(cpage.getByRole("button", { name: m["unsubscribe.resubscribe"] })).toBeFocused();  // review R2-m6
  await expect(section).toContainText(`${made.brand} won't send you any more automated emails.`);
  expect(await newestEmailRow("page")).toEqual({ action: "revoked", method: "unsubscribe_link" });

  const row = await openEmailRow(page, "page");
  await expect(row).toHaveAttribute("data-state", "stopped");
  await expect(row).toContainText("unsubscribe link");
  await expect(row).toContainText(m["contact.email.customerOnly"]);
  await expect(row.getByRole("button", { name: m["contact.email.resume"] })).toHaveCount(0);   // choice 19

  await cpage.getByRole("button", { name: m["unsubscribe.resubscribe"] }).click();
  await expect(section).toHaveAttribute("data-state", "resubscribed");
  await expect(cpage.getByRole("button", { name: m["unsubscribe.button"] })).toBeFocused();
  await expect(section).toContainText(`You'll get emails from ${made.brand} again.`);
  expect(await newestEmailRow("page")).toEqual({ action: "resubscribed", method: "unsubscribe_page" });
  await customer.close();
});

/**
 * A request context the way a mail client makes the RFC 8058 POST: no cookies,
 * no session (X2: "MUST NOT include cookies, HTTP authorization, or any other
 * context information"). The suite's own `request` fixture carries the
 * signed-in storageState, which would prove nothing about A3 (review R2-I6).
 */
async function mailClient(playwright: PlaywrightWorkerArgs["playwright"], baseURL: string | undefined): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
}

test("the one-click POST: 200, empty, no cookie, no redirect; a bad token 400; the GET lands on the page", async ({ playwright, baseURL }) => {
  const request = await mailClient(playwright, baseURL);
  const token = tokenFor(made.contacts[1]!, "click");
  const res = await request.post(`/api/unsubscribe/${token}`, {
    form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0,
  });
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe("");
  expect(res.headers()["set-cookie"]).toBeUndefined();                                              // A3
  expect(res.headers()["location"]).toBeUndefined();
  expect(await newestEmailRow("click")).toEqual({ action: "revoked", method: "one_click" });
  // A second POST is still 200 and writes nothing new (the guard: no second row).
  expect((await request.post(`/api/unsubscribe/${token}`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 })).status()).toBe(200);
  const bad = await request.post(`/api/unsubscribe/1.forged.token`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
  expect(bad.status()).toBe(400);
  const get = await request.get(`/api/unsubscribe/${token}`, { maxRedirects: 0 });
  expect(get.status()).toBe(303);
  expect(get.headers()["location"]).toMatch(new RegExp(`/u/${token.replace(/[.]/g, "\\.")}$`));
  await request.dispose();
});

test("staff Stop emails runs at once with Undo; Resume needs a note and then lifts the stop", async ({ page }) => {
  const row = await openEmailRow(page, "staff");
  await expect(row).toHaveAttribute("data-state", "allowed");
  await row.getByRole("button", { name: m["contact.email.stopEmails"] }).click();
  await expect(row).toHaveAttribute("data-state", "stopped");
  await expect(page.getByTestId("email-row-status")).toBeFocused();
  const toast = page.getByText(m["contact.email.stoppedToast"]);
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(row).toHaveAttribute("data-state", "allowed");
  expect(await newestEmailRow("staff")).toEqual({ action: "resubscribed", method: "staff_undo" });

  await row.getByRole("button", { name: m["contact.email.stopEmails"] }).click();
  await expect(row).toHaveAttribute("data-state", "stopped");
  await row.getByRole("button", { name: m["contact.email.resume"] }).click();
  const form = page.getByTestId("email-resume-form");
  await expect(form.getByRole("button", { name: m["contact.email.resumeSubmit"] })).toBeDisabled();
  await form.getByLabel(m["contact.email.resumeNoteLabel"]).fill("They asked on the phone to get reminders again");
  await form.getByRole("button", { name: m["contact.email.resumeSubmit"] }).click();
  await expect(row).toHaveAttribute("data-state", "allowed");
  expect(await newestEmailRow("staff")).toEqual({ action: "resubscribed", method: "staff" });
});

test("after an unsubscribe, the email composer says so and still lets staff write", async ({ page, playwright, baseURL }) => {
  const contactId = made.contacts[3]!;
  const request = await mailClient(playwright, baseURL);
  expect((await request.post(`/api/unsubscribe/${tokenFor(contactId, "composer")}`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 })).status()).toBe(200);
  await request.dispose();
  await page.goto(`/dashboard/accounts/${fixture().accountId}/contacts/${contactId}`);
  await page.getByRole("button", { name: m["compose.email"], exact: true }).click();
  await expect(page.getByTestId("composer-email-notice")).toContainText("They unsubscribed from your emails on");
  await expect(page.getByPlaceholder(m["compose.subject"])).toBeVisible();                           // choice 22
});
