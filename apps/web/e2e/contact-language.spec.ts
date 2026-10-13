import { test, expect } from "./fixtures/test";
import { serviceDb, createContact, recordLanguageSignal } from "@bis/db";
import { readClientFixture, recordPage } from "./support";
import { m } from "../src/lib/messages";

/**
 * S-09 PR 1: a customer's language on the record page and in the drawer. On the per-run fixture
 * account only; every row is deleted in finally. The sign is recorded through recordLanguageSignal,
 * the function the booking action calls (plan deviation 9).
 */
test.describe("a language on every contact (S-09)", () => {
  test("a booking's Spanish shows on the record and in the drawer; set English, Undo back to the booking", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) { test.skip(true, "No client fixture; run the full suite."); return; }
    const db = serviceDb();
    const stamp = Date.now();
    const { id, existing } = await createContact(db, fixture.accountId, { firstName: "Lengua", lastName: `Cita ${stamp}` }, "e2e-language");
    if (existing) throw new Error("contact-language e2e: matched an existing contact; refusing to use it.");
    try {
      expect(await recordLanguageSignal(db, fixture.accountId, id, { language: "es", source: "booking", at: new Date() }, "public", "system")).toBe(true);
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts/${id}`);
      const row = recordPage(page).locator("[data-language-row]");
      await expect(row).toHaveAttribute("data-language", "es");
      await expect(row.locator("[data-language-phrase]")).toContainText("from their booking (");
      await expect(row.locator('span[lang="es"]')).toHaveText("Español");

      await row.getByRole("combobox", { name: m["contact.language.label"] }).click();
      await page.getByRole("option", { name: "English" }).click();
      await expect(page.getByText(m["contact.language.setToast"].replace("{value}", "English"))).toBeVisible();
      await expect(row).toHaveAttribute("data-language", "en");
      await expect(row.locator("[data-language-phrase]")).toContainText("set by your team (");
      await page.getByRole("button", { name: m["common.undo"] }).click();
      await expect(row).toHaveAttribute("data-language", "es");
      await expect(row.locator("[data-language-phrase]")).toContainText("from their booking (");

      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts?peek=${id}`);
      const drawerRow = page.getByRole("dialog").locator("[data-language-row]");
      await expect(drawerRow).toHaveAttribute("data-language", "es");
      await expect(drawerRow.locator("[data-language-phrase]")).toContainText("from their booking (");
    } finally {
      const { error } = await db.from("contacts").delete().eq("account_id", fixture.accountId).eq("id", id);
      if (error) console.error(`contact-language e2e: cleanup failed: ${error.message}`);
    }
  });

  test("a later disagreeing call shows the hint; Keep hides it after a reload", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) { test.skip(true, "No client fixture; run the full suite."); return; }
    const db = serviceDb();
    const stamp = Date.now();
    const { id, existing } = await createContact(db, fixture.accountId, { firstName: "Pista", lastName: `Llamada ${stamp}` }, "e2e-language");
    if (existing) throw new Error("contact-language e2e: matched an existing contact; refusing to use it.");
    try {
      const t0 = Date.now() - 60_000;
      await recordLanguageSignal(db, fixture.accountId, id, { language: "es", source: "form", at: new Date(t0) }, "form", "system");
      await recordLanguageSignal(db, fixture.accountId, id, { language: "en", source: "call", at: new Date(t0 + 30_000) }, "voice", "ai");
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts/${id}`);
      const hint = recordPage(page).locator("[data-language-hint]");
      await expect(hint).toContainText("Spoke English on the last call. Switch to English?");
      await hint.getByRole("button", { name: m["contact.language.keep"] }).click();
      await expect(page.getByText(m["contact.language.keptToast"])).toBeVisible();
      await page.reload();
      await expect(recordPage(page).locator("[data-language-row]")).toBeVisible();
      await expect(recordPage(page).locator("[data-language-hint]")).toHaveCount(0);
    } finally {
      const { error } = await db.from("contacts").delete().eq("account_id", fixture.accountId).eq("id", id);
      if (error) console.error(`contact-language e2e: cleanup failed: ${error.message}`);
    }
  });
});

/**
 * Step 3 (brief): the Spanish reader, on the client session's Owner — same `users.language` flip and
 * `finally` reset as contacts-drawer.spec.ts's own Spanish describe, copied verbatim because this
 * file runs independently of that one and cannot depend on its module state.
 */
test.describe("a language on every contact (S-09): in Spanish", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("the record reads Spanish: Idioma, and the phrase says por su cita", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) { test.skip(true, "No client fixture; run the full suite."); return; }
    const db = serviceDb();
    const owner = await db.from("memberships").select("user_id")
      .eq("scope", "account").eq("account_id", fixture.accountId).eq("role", "owner").limit(1).single();
    expect(owner.error, `reading the fixture Owner's membership: ${owner.error?.message}`).toBeNull();
    const ownerId = owner.data!.user_id as string;
    const prior = await db.from("users").select("language").eq("id", ownerId).single();
    expect(prior.error, `reading the Owner's language before the switch: ${prior.error?.message}`).toBeNull();
    const priorLanguage = prior.data!.language as string | null;
    const set = await db.from("users").update({ language: "es" }).eq("id", ownerId).select("id");
    expect(set.error, `switching the Owner to Spanish: ${set.error?.message}`).toBeNull();
    expect(set.data, "switching the Owner to Spanish: one users row").toHaveLength(1);

    const stamp = Date.now();
    const { id, existing } = await createContact(db, fixture.accountId, { firstName: "Idioma", lastName: `Prueba ${stamp}` }, "e2e-language");
    if (existing) throw new Error("contact-language e2e: matched an existing contact; refusing to use it.");
    try {
      await recordLanguageSignal(db, fixture.accountId, id, { language: "es", source: "booking", at: new Date() }, "public", "system");
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts/${id}`);
      const row = recordPage(page).locator("[data-language-row]");
      await expect(row.locator("dt")).toHaveText(m["contact.language.label.es"]);
      await expect(row.locator("[data-language-phrase]")).toContainText("por su cita (");
    } finally {
      const { error } = await db.from("contacts").delete().eq("account_id", fixture.accountId).eq("id", id);
      if (error) console.error(`contact-language e2e: cleanup failed: ${error.message}`);
      const reset = await db.from("users").update({ language: priorLanguage }).eq("id", ownerId).select("id");
      expect(reset.error, `resetting the Owner's language: ${reset.error?.message}`).toBeNull();
      expect(reset.data, "resetting the Owner's language: one users row").toHaveLength(1);
    }
  });
});
