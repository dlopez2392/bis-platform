// Everything Playwright from ./fixtures/test, never "@playwright/test" (clerk-cookie-guard.test.ts; plan review I4).
import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createForm, updateForm, upsertVoiceProfile, getAccountTrade, setAccountTrade } from "@bis/db";
import { clerkClient } from "@clerk/nextjs/server";
import { deleteAccountCascade, emptySweepReport } from "./fixtures/sweep";
import { FIXTURE_CO_ACCOUNT_RE } from "./fixtures/stale";
import { m } from "../src/lib/messages";
import { tradeEntry } from "../src/lib/vetting/trades";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-53 tenant vetting (spec section 7). Each test creates (or must fail to create) its OWN company,
 * named `E2E Co <13-digit stamp>` (FIXTURE_CO_ACCOUNT_RE, e2e/fixtures/stale.ts), so a killed run is
 * swept; `finally` removes the Clerk org and the account. Never Test Client One or any live account.
 * The CRM-only test creates a company rather than re-trading the per-run fixture, because the fixture's
 * hvac trade is what the concierge, setup and forward-calls specs rely on.
 */
test.describe.configure({ timeout: 90_000 });

const ACTOR = "e2e-vetting-spec";

/** Exact-name Clerk orgs. `query` is only Clerk's server-side prefilter; the name decides. */
async function clerkOrgsNamed(name: string): Promise<string[]> {
  const { data } = await (await clerkClient()).organizations.getOrganizationList({ query: name, limit: 20 });
  return data.filter((o) => o.name === name).map((o) => o.id);
}

async function cleanup(name: string) {
  // Deletes by NAME, so it refuses any name the sweep itself would not admit: a typo here must never
  // reach a real company.
  if (!FIXTURE_CO_ACCOUNT_RE.test(name)) throw new Error(`vetting.spec cleanup refused "${name}": not an E2E Co fixture name`);
  const db = serviceDb();
  const { data } = await db.from("accounts").select("id, clerk_org_id").eq("name", name);
  const deletedOrgs = new Set<string>();
  for (const acct of data ?? []) {
    if (acct.clerk_org_id) {
      try {
        await (await clerkClient()).organizations.deleteOrganization(acct.clerk_org_id);
        deletedOrgs.add(acct.clerk_org_id);
      } catch (e) { console.error(`vetting.spec cleanup: Clerk org ${acct.clerk_org_id}: ${String(e)}`); }
    }
    const report = emptySweepReport();
    await deleteAccountCascade(db, acct.id, report);
    if (report.errors.length) console.error(`vetting.spec cleanup: ${report.errors.join("; ")}`);
  }
  // An org minted with no account row (a refusal that came too late) is still this run's.
  try {
    for (const id of await clerkOrgsNamed(name)) {
      if (!deletedOrgs.has(id)) await (await clerkClient()).organizations.deleteOrganization(id);
    }
  } catch (e) { console.error(`vetting.spec cleanup: Clerk org lookup for "${name}": ${String(e)}`); }
}

async function openAddCompany(page: Page, name: string, locale: "en" | "es" = "en") {
  await page.goto(locale === "es" ? "/dashboard/accounts?locale=es" : "/dashboard/accounts");
  await page.getByRole("button", { name: /add company/i }).click();
  await page.getByLabel("Business name").fill(name);
}

async function pickTrade(page: Page, label: string) {
  await page.getByRole("combobox", { name: m["vetting.trade.label"] }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test("Add company refuses a held trade with its reason, and creates nothing", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Co ${stamp}`;
  try {
    await openAddCompany(page, name);
    await pickTrade(page, tradeEntry("law")!.label.en);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(tradeEntry("law")!.reason!.en)).toBeVisible({ timeout: 20_000 });
    // The refusal states its language (design check I2): it sits outside the trade field's lang wrapper.
    await expect(dialog.getByRole("alert")).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL(/\/dashboard\/accounts$/);
    const { data, error } = await serviceDb().from("accounts").select("id").eq("name", name);
    expect(error).toBeNull();
    expect(data ?? [], "a held trade must create no account").toEqual([]);
    // Refused BEFORE Clerk (Task 4): no organization under this name either.
    expect(await clerkOrgsNamed(name), "a held trade must mint no Clerk org").toEqual([]);
    // A refusal about a trade no longer chosen is stale: picking another trade clears it (design check M2).
    // Counted by CSS, not by role: while the Select's list is open or closing Radix marks everything outside
    // it aria-hidden, so a role query finds no alert on its first poll whether or not the refusal is still
    // there (the first version of this check passed with the clear removed). The dialog must still be open
    // with what was typed, or "no refusal" would also be true of a closed dialog.
    await pickTrade(page, tradeEntry("plumbing")!.label.en);
    await expect(page.getByRole("combobox", { name: m["vetting.trade.label"] })).toHaveText(tradeEntry("plumbing")!.label.en);
    await expect(page.getByLabel("Business name")).toHaveValue(name);
    await expect(page.locator('[role="dialog"] [data-slot="notice"]')).toHaveCount(0);
  } finally {
    await cleanup(name);
  }
});

test("a CRM-only company is created, and its Sofía and web-chat switches are off with the reason", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Co ${stamp}`;
  try {
    await openAddCompany(page, name);
    await pickTrade(page, tradeEntry("restaurant")!.label.en);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page).toHaveURL(/\/setup$/, { timeout: 30_000 });
    await expect(page.getByTestId("setup-vetting")).toHaveText(m["vetting.crmOnlyCreated"]);
    const accountId = new URL(page.url()).pathname.split("/")[3]!;

    const db = serviceDb();
    expect(await getAccountTrade(db, accountId)).toEqual({ trade: "restaurant", tradeOther: null });

    // Plan review I6: give this company a READY profile (greeting + facts, Receptionist off) and ONE
    // published form, so the web-chat toggle's only possible lock is the trade. With no profile the card
    // would already lock it ("set up the assistant first") and the assertions below would prove nothing.
    // Both rows go with the account in cleanup (forms is in ACCOUNT_OWNED_TABLES; voice_profiles cascades).
    await upsertVoiceProfile(db, accountId, {
      persona_name: "Sofía", greeting_en: "Thanks for calling.", greeting_es: "", facts: "We serve lunch and dinner.",
      languages: "en", enabled: false,
    }, ACTOR);
    const { id: formId } = await createForm(db, accountId, { name: `Vetting chat form ${stamp}` }, ACTOR);
    await updateForm(db, accountId, formId, { status: "published" }, ACTOR);

    await page.goto(`/dashboard/accounts/${accountId}/voice`);
    const reason = m["vetting.sofia.crmOnly"].replace("{trade}", tradeEntry("restaurant")!.label.en.toLowerCase());
    await expect(page.locator("#enabled")).toBeDisabled();
    await expect(page.locator("#sofia-enabled-reason")).toHaveText(reason);
    await expect(page.locator("#sofia-enabled-reason")).toHaveAttribute("lang", "en");
    await expect(page.locator("#concierge_enabled")).toBeDisabled();
    await expect(page.locator("#concierge-toggle-reason")).toHaveText(reason);

    // The control: the SAME company, re-traded to an allowed trade (this test's own company, never the
    // shared fixture), opens both switches. So the trade was the only thing holding them off.
    await setAccountTrade(db, accountId, { trade: "hvac", tradeOther: null }, ACTOR);
    await page.reload();
    await expect(page.locator("#enabled")).toBeEnabled();
    await expect(page.locator("#sofia-enabled-reason")).toHaveCount(0);
    await expect(page.locator("#concierge_enabled")).toBeEnabled();
    await expect(page.locator("#concierge-toggle-reason")).toHaveCount(0);
  } finally {
    await cleanup(name);
  }
});

test("the trade field reads in Spanish and sets lang, and a held trade is refused in Spanish (bilingual DoD)", async ({ page }) => {
  const name = `E2E Co ${Date.now()}`;
  try {
    await openAddCompany(page, name, "es");
    const field = page.getByRole("combobox", { name: m["vetting.trade.label.es"] });
    await expect(field).toBeVisible();
    await expect(page.locator('[lang="es"]').getByRole("combobox", { name: m["vetting.trade.label.es"] })).toBeVisible();
    await field.click();
    // The list is portaled out of the form, so it states its own language (design check I1).
    await expect(page.getByRole("listbox")).toHaveAttribute("lang", "es");
    // Literals, not trades.ts's own words: an English word left in the `es` slot would pass a derived one.
    await expect(page.getByRole("option", { name: "Plomería", exact: true })).toBeVisible();
    await page.getByRole("option", { name: "Despacho de abogados", exact: true }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    // In Spanish because the form posted its locale (final review M3), and saying so (design check I2).
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toHaveText(
      "Aceptaremos despachos de abogados cuando esté lista nuestra hoja para abogados sobre el almacenamiento en la nube en Texas (Opiniones 680 y 705).",
      { timeout: 20_000 },
    );
    await expect(alert).toHaveAttribute("lang", "es");
    expect(await clerkOrgsNamed(name), "a held trade must mint no Clerk org").toEqual([]);
  } finally {
    await cleanup(name);
  }
});
