import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess } from "@bis/db";
import { mintClientToken } from "./support";

// Same two paths, same reason, as auth.setup.ts: this file calls serviceDb()
// and the Clerk API from the Playwright runner process, not through a Next
// request, so nothing auto-loads the env for it.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = (): ClientFixture =>
  JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

/**
 * PostgREST, called directly with the client's own token — the branding
 * spec's `patchAccount`, generalised to a verb. Returns the raw body as well
 * as the status: a bare `status >= 400` passes for ANY refusal, including a
 * typo'd column, so the assertions below read the REASON.
 */
async function rest(
  token: string, method: "GET" | "POST" | "PATCH", query: string, body?: Record<string, unknown>,
): Promise<{ status: number; rows: unknown[]; body: string }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/automations?${query}`, {
    method,
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const rows = res.ok ? (JSON.parse(text) as unknown[]) : [];
  return { status: res.status, rows, body: text };
}

// client-access.spec.ts switches the fixture's access OFF and does not restore
// it (auth.teardown deletes the fixture). Establish the precondition here, as
// client-branding.spec.ts does, so filename order cannot decide the result.
test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

/**
 * The M2 lesson governs this file: the POSITIVE case comes first, because
 * every negative below would pass just as happily against a client that can
 * read nothing at all.
 *
 * Cross-tenant READ isolation is proven in packages/db's
 * automations-grants.test.ts (two seeded accounts, rolled back). It is not
 * repeated here because the only other account this runner can see is the
 * agency's live seeded one, and CLAUDE.md forbids mutating specs on it.
 */
test.describe("a client's automations boundary, at the database", () => {
  test("reads its own row, and is refused BY PRIVILEGE on every write", async () => {
    const { accountId, clerkUserId } = fixture();
    const db = serviceDb();
    // A raw insert, not the accessor: this spec is written before the
    // accessor exists (Task 1) and keeps proving the grant whatever the
    // accessor later does.
    const { data: seeded, error: seedErr } = await db.from("automations")
      .insert({ account_id: accountId, recipe_key: "review_request" })
      .select("id").single();
    if (seedErr || !seeded) throw new Error(`could not seed the automations row: ${seedErr?.message}`);
    const token = await mintClientToken(clerkUserId);

    try {
      // 1. THE POSITIVE CASE.
      const own = await rest(token, "GET", `account_id=eq.${accountId}&select=id,recipe_key,enabled`);
      expect(own.status, own.body).toBe(200);
      expect(own.rows).toEqual([{ id: seeded.id, recipe_key: "review_request", enabled: false }]);

      // 2. INSERT. `42501` is insufficient_privilege; a misspelled column
      //    would be PGRST204 and an RLS refusal 42501-free — this discriminates.
      const insert = await rest(token, "POST", "select=id",
        { account_id: accountId, recipe_key: "review_request" });
      expect(insert.status).toBeGreaterThanOrEqual(400);
      expect(insert.body, "insert must be refused by privilege").toContain("42501");

      // 3. UPDATE — the escalation the grant exists to stop: a client
      //    switching their own automation on.
      const update = await rest(token, "PATCH", `id=eq.${seeded.id}&select=id`, { enabled: true });
      expect(update.status).toBeGreaterThanOrEqual(400);
      expect(update.body, "update must be refused by privilege").toContain("42501");
      const { data: after } = await db.from("automations").select("enabled").eq("id", seeded.id).single();
      expect((after as { enabled: boolean } | null)?.enabled).toBe(false);
    } finally {
      await db.from("automations").delete().eq("id", seeded.id);
    }
  });
});

test.describe("the Automations page", () => {
  test("the agency reaches it from the nav and sees the review-request card", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    await page.getByRole("link", { name: "Automations" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/automations$`));
    await expect(page.getByText("Review requests", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Review link")).toBeVisible();

    // The residual the spec names: the live counter. Switch to Text message,
    // type a link, and the count must be the body PLUS the link, as ONE
    // segment for the default body (measured in review-request-copy.test.ts).
    // Nothing is saved — the form is never submitted.
    await page.getByTestId("review-request-card").getByLabel("Send by").click();
    await page.getByRole("option", { name: "Text message" }).click();
    await page.locator("#review_url").fill("https://g.page/r/CXyZ123abc/review");
    await expect(page.getByTestId("review-sms-count")).toContainText("1 message(s)");
  });
});

test.describe("a client cannot reach the Automations page", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("is sent to their own dashboard, and the nav never offered it", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/dashboard$`));
    await expect(page.getByRole("link", { name: "Automations" })).toHaveCount(0);
  });
});

test.describe("the Automations page — Milestone B cards", () => {
  test("the no-show and text-reminder cards preview the composed message — link and time included — as one segment", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);

    const noShow = page.getByTestId("no-show-nudge-card");
    await expect(noShow.getByText("No-show follow-ups", { exact: true })).toBeVisible();
    await expect(noShow.getByTestId("no-show-link")).toContainText("/b/");
    await noShow.getByLabel("Send by").click();
    await page.getByRole("option", { name: "Text message" }).click();
    await expect(noShow.getByTestId("no-show-sms-count")).toContainText("1 message(s)");

    const reminder = page.getByTestId("sms-reminder-card");
    await expect(reminder.getByText("Text reminders", { exact: true })).toBeVisible();
    await expect(reminder.getByTestId("sms-reminder-preview")).toContainText("Reminder: your appointment");
    await expect(reminder.getByTestId("sms-reminder-count")).toContainText("1 message(s)");
    // Nothing is saved — no form is submitted.
  });
});
