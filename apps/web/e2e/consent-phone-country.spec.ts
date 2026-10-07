import { test, expect } from "./fixtures/test";
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
// serial: test 3 depends on test 2 having settled the number as US on the
// SAME contact (STAMP is module-level, one beforeAll for the file) — a
// worker restart between them would re-run beforeAll with a fresh STAMP and
// silently swap in a brand-new, still-ambiguous contact (precedent:
// contacts-data.spec.ts:32).
test.describe.configure({ mode: "serial", timeout: 120_000 });

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
  // the Undo button (review R3-M5). #151: a plain hover failed CI's hit-target
  // check twice — the drawer's own subtree was intercepting pointer events
  // (Radix sets `body{pointer-events:none}` while it's open, and the toaster
  // had no override), so the mouse never actually reached the toast. Fixed at
  // the source (sonner.tsx's pointer-events-auto + Sheet/Dialog's
  // onInteractOutside exemption in interact-outside.ts) rather than forcing
  // past the check here, since `force` is exactly what let the bug through.
  await toast.hover();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["contact.phoneCountry.mxToast"] }))
    .toHaveAttribute("data-expanded", "true");
  await expect(row).toHaveCount(0);
  // Review R3-I4: the pressed button is gone; the row's status line keeps the keyboard.
  await expect(page.getByRole("dialog").getByTestId("texts-row-status")).toBeFocused();
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
  // exact: true — the drawer's sr-only description ("Contact details, tags,
  // and recent activity.") also contains "recent", and the substring match
  // resolves both; the exact heading only exists once the summary has
  // loaded, so the row assertion below reads loaded data, not a race.
  await expect(page.getByRole("dialog").getByText(m["drawer.recent"], { exact: true })).toBeVisible();
  // The Texts row is its own read (consent chain PR-2): wait for it to have
  // LOADED — a data-state — or the count below passes against its skeleton.
  await expect(page.getByRole("dialog").getByTestId("texts-row")).toHaveAttribute("data-state", /.+/);
  await expect(page.getByRole("dialog").getByTestId("phone-country-row")).toHaveCount(0);
});

test("a phone edited in the drawer into one that reads both ways raises the Check number row, no reload (review R3-I2)", async ({ page }) => {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `Number ${STAMP}` }).first().click();
  const drawer = page.getByRole("dialog");
  // exact: true — the drawer's sr-only description also contains "recent",
  // and the exact heading only exists once the summary has loaded, so the
  // row assertion below reads loaded data, not a race.
  await expect(drawer.getByText(m["drawer.recent"], { exact: true })).toBeVisible();
  // The test above settled it as US: no row — once the Texts row has loaded
  // (its own read since consent chain PR-2; the skeleton has no data-state).
  await expect(drawer.getByTestId("texts-row")).toHaveAttribute("data-state", /.+/);
  await expect(drawer.getByTestId("phone-country-row")).toHaveCount(0);

  await drawer.getByRole("button", { name: /edit phone/i }).click();
  await drawer.getByLabel(m["contacts.phone"], { exact: true }).fill("55 1234 5679");
  await page.keyboard.press("Enter");
  // The drawer re-reads its summary after a phone save; without that the row
  // would stay hidden until a reload.
  await expect(drawer.getByTestId("phone-country-row")).toBeVisible();
  expect(await stored()).toEqual({ phone: "+15512345679", phone_country_unconfirmed: true });
});
