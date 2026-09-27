import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every spec that talks to Supabase from the
// runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Consent chain PR-1, F-009 (spec §6): the drawer's Texts row in its Check
 * number state, end to end. The contact is created through `createContact`
 * with a number that reads both ways, so this also proves the normalise-on-
 * write path against the real table: stored +1, flagged.
 *
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY ("E2E Client Co …", auth.setup.ts),
 * never Test Client One (CLAUDE.md). Its own contact, deleted in afterAll.
 *
 * Not proven here: the composer's closed state. The fixture account has no
 * approved A2P registration, so the Text tab shows the A2P line first
 * (message-composer.tsx's order); the line itself is pinned in
 * [contactId]/page.test.ts and lib/consent/composer-state.test.ts.
 */
test.describe.configure({ timeout: 120_000 });

type ClientFixture = { accountId: string; clerkUserId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE} — run the full suite`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};
const ACTOR = "e2e-consent-phone-country";
const STAMP = Date.now().toString();
let contactId = "";

async function stored(): Promise<{ phone: string | null; phone_country_unconfirmed: boolean }> {
  const { data, error } = await serviceDb().from("contacts")
    .select("phone, phone_country_unconfirmed").eq("id", contactId).single();
  if (error) throw new Error(`consent-phone-country e2e: read failed: ${error.message}`);
  return data as { phone: string | null; phone_country_unconfirmed: boolean };
}

test.beforeAll(async () => {
  const { accountId } = fixture();
  contactId = (await createContact(serviceDb(), accountId,
    { firstName: "Check", lastName: `Number ${STAMP}`, phone: "55 1234 5678" }, ACTOR)).id;
});

test.afterAll(async () => {
  if (!contactId) return;
  const { error } = await serviceDb().from("contacts").delete().eq("id", contactId);
  if (error) console.error(`consent-phone-country e2e: cleanup failed: ${error.message}`);
});

test("an ambiguous number: stored +1 and flagged; Mexico (+52) rewrites it, Undo puts it back", async ({ page }) => {
  const { accountId } = fixture();
  expect(await stored()).toEqual({ phone: "+15512345678", phone_country_unconfirmed: true });

  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `Number ${STAMP}` }).first().click();
  const row = page.getByRole("dialog").getByTestId("phone-country-row");
  await expect(row).toContainText(m["contact.phoneCountry.word"]);
  await expect(row).toContainText(m["contact.phoneCountry.line"]);

  await row.getByRole("button", { name: m["contact.phoneCountry.mx"] }).click();
  // The toast appears once the action has resolved, so the write has landed.
  const toast = page.getByText(m["contact.phoneCountry.mxToast"]);
  await expect(toast).toBeVisible();
  // Hovering pauses Sonner's 4 s timer, so the DB read below cannot outlast
  // the Undo button (review R3-M5).
  await toast.hover();
  await expect(row).toHaveCount(0);
  expect(await stored()).toEqual({ phone: "+525512345678", phone_country_unconfirmed: false });

  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(page.getByRole("dialog").getByTestId("phone-country-row")).toBeVisible();
  await expect.poll(stored).toEqual({ phone: "+15512345678", phone_country_unconfirmed: true });
});

test("a reload after a pick shows no Check number row: the server's answer, not the click's", async ({ page }) => {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `Number ${STAMP}` }).first().click();
  const row = page.getByRole("dialog").getByTestId("phone-country-row");
  await row.getByRole("button", { name: m["contact.phoneCountry.us"] }).click();
  await expect(page.getByText(m["contact.phoneCountry.usToast"])).toBeVisible();
  expect(await stored()).toEqual({ phone: "+15512345678", phone_country_unconfirmed: false });

  await expect(page).toHaveURL(/[?&]peek=/);
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(m["drawer.recent"])).toBeVisible();
  await expect(page.getByRole("dialog").getByTestId("phone-country-row")).toHaveCount(0);
});

test("a phone edited in the drawer into one that reads both ways raises the Check number row, no reload (review R3-I2)", async ({ page }) => {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `Number ${STAMP}` }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText(m["drawer.recent"])).toBeVisible();
  // The test above settled it as US: no row.
  await expect(drawer.getByTestId("phone-country-row")).toHaveCount(0);

  await drawer.getByRole("button", { name: /edit phone/i }).click();
  await drawer.getByLabel(m["contacts.phone"], { exact: true }).fill("55 1234 5679");
  await page.keyboard.press("Enter");
  // The drawer re-reads its summary after a phone save; without that the row
  // would stay hidden until a reload.
  await expect(drawer.getByTestId("phone-country-row")).toBeVisible();
  expect(await stored()).toEqual({ phone: "+15512345679", phone_country_unconfirmed: true });
});
