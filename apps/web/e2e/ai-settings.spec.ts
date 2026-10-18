import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { readClientFixture } from "./support";
import { periodKeys } from "../src/lib/ai/period";
import { m, type MessageKey } from "../src/lib/messages";

// Same two paths, same reason, as weekly-report.spec.ts: the runner talks to Supabase directly for setup and cleanup.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

test.describe.configure({ mode: "serial", timeout: 90_000 });

/**
 * Item 8a-1 (spec 3.6, 8.4): the agency's AI card on the PER-RUN fixture account only (never Test Client One).
 * The global switch is opened and CANCELLED, never confirmed: a local run shares bis-ci with Preview.
 * Words come from the catalogue in the card's own `lang`, never hard-coded.
 */
let accountId = "";
async function words(page: Page) {
  const lang = await page.locator("#ai[data-ai-card]").getAttribute("lang");
  return (key: MessageKey, params: Record<string, string | number> = {}) => {
    const raw = (lang === "es" ? (m as Record<string, string>)[`${key}.es`] : undefined) ?? m[key];
    return Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), raw);
  };
}
async function settingsRow() {
  const { data, error } = await serviceDb().from("account_ai_settings").select("enabled, monthly_budget_cents").eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`ai e2e: settings read failed: ${error.message}`);
  return data as { enabled: boolean; monthly_budget_cents: number } | null;
}
async function clean() {
  const db = serviceDb();
  for (const table of ["ai_ledger", "account_ai_settings"]) {
    const { error } = await db.from(table).delete().eq("account_id", accountId);
    if (error) throw new Error(`ai e2e cleanup: ${table} failed: ${error.message}`);
  }
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("No client fixture: the setup project creates it; run the full suite.");
  accountId = fixture.accountId;
  await clean();
  const db = serviceDb();
  const { data: acct, error } = await db.from("accounts").select("timezone").eq("id", accountId).single();
  if (error) throw new Error(`ai e2e: account read failed: ${error.message}`);
  const { monthKey, dayKey } = periodKeys(new Date(), (acct as { timezone: string | null }).timezone ?? "America/Chicago");
  const s = await db.from("account_ai_settings").insert({ account_id: accountId, month_key: monthKey, month_spend_microusd: 1_840_000, day_key: dayKey });
  if (s.error) throw new Error(`ai e2e: settings seed failed: ${s.error.message}`);
  const l = await db.from("ai_ledger").insert({ account_id: accountId, feature: "call_summary", model: "gpt-4o-mini", outcome: "account_off" });
  if (l.error) throw new Error(`ai e2e: ledger seed failed: ${l.error.message}`);
});

test.afterAll(async () => {
  if (!accountId) return;
  await clean();
  const db = serviceDb();
  for (const table of ["ai_ledger", "account_ai_settings"]) {
    const { count, error } = await db.from(table).select("account_id", { count: "exact", head: true }).eq("account_id", accountId);
    if (error || count !== 0) throw new Error(`ai e2e cleanup: ${table} still holds ${count} rows (${error?.message ?? "no error"})`);
  }
});

test("the AI card shows this month's spend and how often AI was skipped, read through the agency's own session", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#ai`);
  const card = page.locator("#ai[data-ai-card]");
  await expect(card).toBeVisible();
  const w = await words(page);
  await expect(card.locator("[data-ai-spend]")).toHaveText(w("aiSettings.spend", { spent: "$1.84", budget: "$10.00" }));
  await expect(card.locator("[data-ai-skipped]")).toHaveText(w("aiSettings.skippedOne"));
  await expect(card.locator("[data-ai-empty]")).toHaveCount(0);
});

test("switching AI off for this account saves at once, and Undo puts it back", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#ai`);
  const card = page.locator("#ai[data-ai-card]");
  const w = await words(page);
  await card.locator("[data-ai-account]").click();
  await card.locator("[data-ai-save]").click();
  const saved = page.locator("[data-sonner-toast]").filter({ hasText: w("aiSettings.saved") });
  await expect(saved).toBeVisible();
  await expect.poll(settingsRow).toEqual({ enabled: false, monthly_budget_cents: 1000 });
  await saved.getByRole("button", { name: w("common.undo") }).click();
  await expect.poll(settingsRow).toEqual({ enabled: true, monthly_budget_cents: 1000 });
});

test("a budget with cents is refused and nothing is written", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#ai`);
  const card = page.locator("#ai[data-ai-card]");
  const w = await words(page);
  await card.locator("[data-ai-budget]").fill("10.50");
  await card.locator("[data-ai-save]").click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: w("aiSettings.error.budget") })).toBeVisible();
  expect(await settingsRow()).toEqual({ enabled: true, monthly_budget_cents: 1000 });
});

test("turning AI off everywhere waits for the typed word; Cancel leaves it on", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#ai`);
  const card = page.locator("#ai[data-ai-card]");
  const w = await words(page);
  await card.locator("[data-ai-global-off]").click();
  const dialog = page.locator("[data-ai-confirm]");
  await expect(dialog).toBeVisible();
  const confirm = dialog.locator("[data-ai-confirm-off]");
  await expect(confirm).toBeDisabled();
  const word = w("aiSettings.global.confirmWord");
  await dialog.locator("[data-ai-confirm-input]").fill(word.slice(0, -1));
  await expect(confirm).toBeDisabled();
  await dialog.locator("[data-ai-confirm-input]").fill(word.toLowerCase());
  await expect(confirm).toBeEnabled();
  await dialog.getByRole("button", { name: w("aiSettings.global.cancel") }).click();
  await expect(dialog).toHaveCount(0);
  const { data, error } = await serviceDb().from("ai_gateway_settings").select("enabled").eq("id", true).single();
  if (error) throw new Error(`ai e2e: global read failed: ${error.message}`);
  expect(data).toEqual({ enabled: true });
});
