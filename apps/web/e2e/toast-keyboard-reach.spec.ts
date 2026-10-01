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
 * Follow-up to #151 (consent-phone-country.spec.ts's own toast fix): a
 * keyboard user inside the open contact drawer could not reach the Undo
 * toast's button at all — the drawer's Radix FocusScope traps Tab inside
 * itself, and sonner's own default Alt+T hotkey (sonner/dist/index.mjs:
 * 918-920) gets immediately overridden by that same trap (its document-level
 * `focusin` listener snaps focus back whenever it lands outside the drawer's
 * own container — @radix-ui/react-focus-scope/dist/index.mjs:39-46).
 * sonner.tsx now mounts a fresh trapped FocusScope of its own around the
 * toaster the moment Alt+T is pressed, which — by Radix's own
 * focus-scope-stack rules — pauses the drawer's trap and takes over until
 * Escape or the Undo click releases it again.
 *
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY ("E2E Client Co …", auth.setup.ts),
 * never Test Client One (CLAUDE.md). Its own contact, deleted in afterAll.
 *
 * NOT RUN LOCALLY: Playwright is not mine to run (frontend-engineer role);
 * local env also still points at production, which the suite refuses by
 * design (#135). CI runs this.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

type ClientFixture = { accountId: string; clerkUserId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE} — run the full suite`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};
const ACTOR = "e2e-toast-keyboard-reach";
const STAMP = Date.now().toString();
let contactId = "";

async function stored(): Promise<{ phone: string | null; phone_country_unconfirmed: boolean }> {
  const { data, error } = await serviceDb().from("contacts")
    .select("phone, phone_country_unconfirmed").eq("id", contactId).single();
  if (error) throw new Error(`toast-keyboard-reach e2e: read failed: ${error.message}`);
  return data as { phone: string | null; phone_country_unconfirmed: boolean };
}

test.beforeAll(async () => {
  const { accountId } = fixture();
  contactId = (await createContact(serviceDb(), accountId,
    { firstName: "KBReach", lastName: `Number ${STAMP}`, phone: "55 1234 5678" }, ACTOR)).id;
});

test.afterAll(async () => {
  if (!contactId) return;
  const { error } = await serviceDb().from("contacts").delete().eq("id", contactId);
  if (error) console.error(`toast-keyboard-reach e2e: cleanup failed: ${error.message}`);
});

test("Alt+T reaches the Undo toast's button while the drawer stays open and trapped; Enter activates it", async ({ page }) => {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `Number ${STAMP}` }).first().click();
  const drawer = page.getByRole("dialog");
  const row = drawer.getByTestId("phone-country-row");
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: m["contact.phoneCountry.mx"] }).click();
  await expect(page.getByText(m["contact.phoneCountry.mxToast"])).toBeVisible();
  expect(await stored()).toEqual({ phone: "+525512345678", phone_country_unconfirmed: false });
  // Review R3-I4 (consent-phone-country.spec.ts:89): the app itself parks
  // keyboard focus on the row's status line after the pressed button
  // unmounts — this is what jump mode must hand focus BACK to on Escape.
  await expect(drawer.getByTestId("texts-row-status")).toBeFocused();

  await page.keyboard.press("Alt+T");
  const undoButton = page.getByRole("button", { name: m["common.undo"] });
  await expect(undoButton).toBeFocused();
  // The drawer itself is untouched: still open, still a dialog, still the
  // same contact — Alt+T only ever reached the toast, nothing closed.
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("phone-country-row")).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect(drawer.getByTestId("phone-country-row")).toBeVisible();
  await expect.poll(stored).toEqual({ phone: "+15512345678", phone_country_unconfirmed: true });
});

test("Escape leaves jump mode and returns focus into the drawer, without closing it", async ({ page }) => {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `Number ${STAMP}` }).first().click();
  const drawer = page.getByRole("dialog");
  const row = drawer.getByTestId("phone-country-row");
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: m["contact.phoneCountry.mx"] }).click();
  await expect(page.getByText(m["contact.phoneCountry.mxToast"])).toBeVisible();
  const statusLine = drawer.getByTestId("texts-row-status");
  await expect(statusLine).toBeFocused();

  await page.keyboard.press("Alt+T");
  await expect(page.getByRole("button", { name: m["common.undo"] })).toBeFocused();

  await page.keyboard.press("Escape");
  // The drawer's OWN Escape-closes-overlay handler never saw this keystroke
  // — sonner.tsx's jump-mode listener claims it at `window`'s capture phase,
  // which always runs before the drawer's own `ownerDocument`-level capture
  // listener (@radix-ui/react-dismissable-layer/dist/index.mjs:101-106).
  await expect(drawer).toBeVisible();
  // Radix's own FocusScope unmount-autofocus returns focus to whatever was
  // focused before jump mode engaged.
  await expect(statusLine).toBeFocused();

  // Clean up the write this test made, same as the mouse-driven spec does.
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(drawer.getByTestId("phone-country-row")).toBeVisible();
  await expect.poll(stored).toEqual({ phone: "+15512345678", phone_country_unconfirmed: true });
});
