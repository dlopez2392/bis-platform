import { type Page, expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { contrastRatio } from "../src/lib/branding/color";

/**
 * `rgb(30, 58, 138)` — what getComputedStyle reports — back to `#1e3a8a`, so
 * a painted colour can be measured rather than only compared to a literal.
 *
 * This exists because M4b made the exact value a tenant's Submit button wears
 * a DERIVED one: it is lifted for the tenant's own surfaces, so pinning a hex
 * in a spec would either duplicate the derivation or freeze whichever answer
 * it happened to give. The property worth asserting is that it stays legible.
 */
export function hexOf(cssColor: string): string {
  const [r, g, b] = cssColor.match(/\d+/g)!.map(Number) as [number, number, number];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The contrast ratio between two colours as getComputedStyle reports them. */
export function paintedContrast(a: string, b: string): number {
  return contrastRatio(hexOf(a), hexOf(b));
}

/**
 * The one account seeded in this environment with real data: one contact
 * (Maria Garcia) and one opportunity (Deck build). Specs that need actual
 * rows to assert against should target this account by name rather than
 * grabbing whichever company card renders first on /dashboard/accounts —
 * when stray empty accounts existed alongside it, "first card" landed on
 * an empty company and both the contacts and pipeline specs failed with
 * no table / no opportunity cards to find.
 */
export const SEEDED_ACCOUNT_NAME = "Test Client One";

/**
 * The seeded contact on that account, and the only one guaranteed to carry an
 * EMAIL ADDRESS — which the composer's email mode requires (with none on file
 * it renders "no email on this contact" and never shows a Subject field).
 *
 * Named rather than taken positionally. `listContacts` orders by `created_at`
 * descending, so `.first()` means "whoever rang most recently" — and real
 * voice calls have since created contacts on this shared account from nothing
 * but a phone number, with `email` null. That is exactly the positional-
 * locator trap `openAccountByName` above was written for, one level down:
 * `.first()` was only ever the seeded contact by accident of it being the
 * only one.
 */
export const SEEDED_CONTACT_NAME = "Maria Garcia";

/**
 * Navigates to /dashboard/accounts and opens the card for `accountName`,
 * found by its accessible name rather than position. If no such card is
 * present — a fresh or reset database, or the seed data being renamed —
 * skips the current test with a clear reason instead of silently falling
 * back to some other account and passing (or failing) against the wrong
 * data.
 *
 * Returns only once the browser is INSIDE the account. `click()` resolves when
 * the click is dispatched, not when the client-side navigation it starts has
 * landed, and every caller acts on the account next. palette.spec.ts paid for
 * that (CI run 35776929496): its trace shows ⌘K pressed and "cal" typed while
 * the URL was still `/dashboard/accounts`, so the palette answered for the
 * agency top level — one option, "Screened calls" — and then re-answered for
 * the account when the navigation landed mid-assertion.
 */
export async function openAccountByName(page: Page, accountName: string) {
  await page.goto("/dashboard/accounts");
  const card = page.getByRole("link", { name: accountName });
  if ((await card.count()) === 0) {
    test.skip(true, `No account named "${accountName}" found on /dashboard/accounts — seed it before running this spec.`);
    return;
  }
  await card.click();
  await expect(page).toHaveURL(/\/dashboard\/accounts\/[0-9a-f-]{36}(?:[/?#]|$)/);
}

/**
 * The per-run client fixture auth.setup.ts creates and auth.teardown.ts
 * deletes — the account for specs that MUTATE account state (calendar
 * settings, bookings). Written on 2026-08-30, the day the booking journeys'
 * "reset the calendar to disabled when done" convention wiped a LIVE video
 * exit-gate configuration on `Test Client One` twice in one afternoon: there
 * is exactly ONE Supabase project, so an e2e write to the shared seeded
 * account IS a production write. Specs that only need to READ real rows
 * (calls.spec's real phone calls, messaging's seeded contact) stay on
 * `Test Client One`; anything that changes account-level state belongs here,
 * where the whole account evaporates after the run.
 */
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

export function readClientFixture(): { accountId: string; companyName: string } | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as {
    accountId?: string; companyName?: string;
  };
  if (!parsed.accountId || !parsed.companyName) return null;
  return { accountId: parsed.accountId, companyName: parsed.companyName };
}

/**
 * Opens the fixture account's Calendar page directly by id (the agency
 * session sees every account, and the id is authoritative from the fixture
 * file — no card-by-name lookup to race). Skips with a clear reason when the
 * fixture file is missing, e.g. a spec run that bypassed the setup project.
 */
export async function openFixtureCalendar(page: Page): Promise<string> {
  const fixture = readClientFixture();
  if (!fixture) {
    test.skip(true, `No client fixture at ${CLIENT_FIXTURE_FILE} — the setup project creates it; run the full suite.`);
    return "";
  }
  await page.goto(`/dashboard/accounts/${fixture.accountId}/calendar`);
  return fixture.accountId;
}

/**
 * A real Clerk session token for a fixture's CLIENT user, minted the same
 * two-call way packages/db's user-client integration test does.
 *
 * Not stubbed. The boundary under test is Clerk's claims meeting Supabase's
 * policies, so a hand-made JWT would prove nothing about either — it would
 * only prove that a token the test invented is accepted or rejected. Shared
 * by client-branding.spec.ts and automations.spec.ts.
 */
export async function mintClientToken(userId: string): Promise<string> {
  const sk = process.env.CLERK_SECRET_KEY;
  if (!sk) throw new Error("CLERK_SECRET_KEY missing — this spec cannot run hermetically");
  const headers = { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" };

  const session = (await (await fetch("https://api.clerk.com/v1/sessions", {
    method: "POST", headers, body: JSON.stringify({ user_id: userId }),
  })).json()) as { id?: string };
  if (!session.id) throw new Error(`could not create a Clerk session for ${userId}`);

  const token = (await (await fetch(
    `https://api.clerk.com/v1/sessions/${session.id}/tokens`, { method: "POST", headers },
  )).json()) as { jwt?: string };
  if (!token.jwt) throw new Error("Clerk returned no jwt");
  return token.jwt;
}
