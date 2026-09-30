import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, getOrCreateCalendar } from "@bis/db";
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
  // The page reads the calendar and never creates it; this spec's link
  // assertion needs one to exist, as it would for any company that has
  // opened Calendar once.
  await getOrCreateCalendar(serviceDb(), accountId, clerkUserId);
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
    // type a link, and the count must be what SENDS: the default body, the
    // link, and the opt-out sentence `sendAutomationSms` appends to every
    // automated text (decision B, 2026-09-22). MEASURED with the real
    // functions for the fixture's BRAND name — `Rio Roofing ${stamp}`,
    // auth.setup.ts, 25 characters while Date.now() has 13 digits — not its
    // internal company name: 129 septets composed, 152 disclosed, one
    // segment. Nothing is saved — the form is never submitted.
    await page.getByTestId("review-request-card").getByLabel("Send by").click();
    await page.getByRole("option", { name: "Text message" }).click();
    await page.locator("#review_url").fill("https://g.page/r/CXyZ123abc/review");
    await expect(page.getByTestId("review-sms-count")).toHaveText("152 characters · 1 message(s)");
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
  test("the no-show and text-reminder cards count the text that sends — link, time and opt-out sentence included, one message each", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);

    const noShow = page.getByTestId("no-show-nudge-card");
    await expect(noShow.getByText("No-show follow-ups", { exact: true })).toBeVisible();
    await expect(noShow.getByTestId("no-show-link")).toContainText("/b/");
    await noShow.getByLabel("Send by").click();
    await page.getByRole("option", { name: "Text message" }).click();
    // ONE. MEASURED with segmentsFor/withOptOut/composeNoShowNudgeSms for the
    // fixture's 25-character brand name: the default plus the booking link
    // (origin + `/b/` + a 12-character id) plus the opt-out sentence is 147
    // septets on http://localhost:3000, 148 on https://localhost:3000 and
    // 149 on https://app.bis-rgv.com, one segment each. (The longer default
    // this replaced measured 171–173 here, two.) The character count depends
    // on the origin the server resolves (APP_ORIGIN, else the request's
    // host), so only the message count is pinned — and an origin longer than
    // 34 characters (a preview URL under E2E_BASE_URL) WOULD make it two.
    await expect(noShow.getByTestId("no-show-sms-count")).toHaveText(/^\d+ characters · 1 message\(s\)$/);

    const reminder = page.getByTestId("sms-reminder-card");
    await expect(reminder.getByText("Text reminders", { exact: true })).toBeVisible();
    await expect(reminder.getByTestId("sms-reminder-preview")).toContainText("Reminder: your appointment");
    await expect(reminder.getByTestId("sms-reminder-count")).toContainText("1 message(s)");
    // Nothing is saved — no form is submitted.
  });
});

test.describe("the Automations page — Milestone C card", () => {
  test("the instant-reply card previews both texts as they send, opt-out sentence included, one message each, and the counter follows the text", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);

    const card = page.getByTestId("instant-reply-card");
    await expect(card.getByText("Instant reply to new leads", { exact: true })).toBeVisible();
    // MEASURED for the fixture's 25-character BRAND name (`Rio Roofing
    // ${stamp}`, auth.setup.ts): English 130 septets composed, 153 with
    // "Reply STOP to opt out." — one segment; Spanish 120 composed, 149 with
    // "Responde STOP para cancelar." — one segment. The Spanish default holds
    // a GSM-7 name of up to 36 characters, the English up to 32 (pinned in
    // instant-reply-copy.test.ts; the longer Spanish default this replaced
    // measured 173 here, two).
    await expect(card.getByTestId("instant-reply-preview-en")).toContainText("We got your message");
    await expect(card.getByTestId("instant-reply-preview-en")).toContainText("Reply STOP to opt out.");
    await expect(card.getByTestId("instant-reply-count-en")).toHaveText("153 characters · 1 message(s)");
    await expect(card.getByTestId("instant-reply-preview-es")).toContainText("Recibimos tu mensaje");
    await expect(card.getByTestId("instant-reply-preview-es")).toContainText("Responde STOP para cancelar.");
    await expect(card.getByTestId("instant-reply-count-es")).toHaveText("149 characters · 1 message(s)");

    // Typing redraws the preview and the counter — the counter counts the
    // string that sends, which is the typed text PLUS the opt-out sentence
    // every automated text carries: 15 septets typed, 38 sent (measured).
    await card.getByLabel("English message").fill("Got it, thanks!");
    await expect(card.getByTestId("instant-reply-preview-en")).toHaveText("Got it, thanks! Reply STOP to opt out.");
    await expect(card.getByTestId("instant-reply-count-en")).toContainText("38 characters");
    // Nothing is saved — the form is never submitted. e2e shares the
    // production database; this recipe must NEVER be enabled here.
  });
});
