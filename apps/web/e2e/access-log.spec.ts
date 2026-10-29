import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { clerkSetup } from "@clerk/testing/playwright";
import { clerkClient } from "@clerk/nextjs/server";
import { serviceDb } from "@bis/db";
import { signInWithTicket, setActiveOrganization } from "./fixtures/clerk-identities";
import { m } from "../src/lib/messages";
import { recordPage } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase or
// Clerk from the Playwright runner process rather than through a Next.js
// request (this file mints a brand-new agency sign-in of its own, below).
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * F-118 part 1 (spec test 15; plan Task 12). Everything in this file runs on
 * the PER-RUN FIXTURE ACCOUNT — never on Test Client One, read or write (the
 * suite's hard rule): proving a deep link lands correctly, that the Owner
 * reads exactly what BIS opened, and that Staff cannot read it at all means
 * writing real visits and real items, and the fixture account evaporates
 * after the run while the seeded one does not.
 *
 * This is also the one spec that signs the agency in a SECOND time
 * (auth.setup.ts's fifth setup test already gave the shared agency session a
 * reason for this account, so re-using that session would never meet the
 * chooser). A fresh sign-in is a fresh Clerk session id, which §3.3 treats as
 * a visit of its own — exactly the session this spec needs to prove the gate
 * against.
 */
test.describe.configure({ timeout: 180_000 });

type AgencyFixture = { clerkUserId: string; clerkOrgId: string };
const AGENCY_FIXTURE_FILE = "e2e/.auth/agency-fixture.json";

type ClientFixtureFull = { accountId: string; companyName: string; contactName: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/**
 * Read at RUN TIME, never at module scope — contacts-drawer.spec.ts's own
 * reasoning (module scope runs during Playwright's COLLECTION phase, before
 * the "setup" project has written either file, which silently skipped every
 * test in that file on a fresh checkout). Missing at run time means the
 * "setup" project did not run (a filtered invocation, or a bare
 * `playwright test <file>`), which is a FAILURE here, not a skip.
 */
function agencyFixture(): AgencyFixture {
  if (!existsSync(AGENCY_FIXTURE_FILE)) {
    throw new Error(
      `agency fixture missing at ${AGENCY_FIXTURE_FILE} — the "setup" project did not run. ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return JSON.parse(readFileSync(AGENCY_FIXTURE_FILE, "utf-8")) as AgencyFixture;
}

function fullFixture(): ClientFixtureFull {
  if (!existsSync(CLIENT_FIXTURE_FILE)) {
    throw new Error(
      `client fixture missing at ${CLIENT_FIXTURE_FILE} — the "setup" project did not run ` +
      `(a filtered invocation, or a bare "playwright test <file>", skips its dependency). ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as ClientFixtureFull;
}

/**
 * The fixture contact's id, read-only, through the service role — never
 * created here. auth.setup.ts's `contactName` is "E2E Fixture <stamp>"; the
 * last name alone (everything after the first word) is what it stored in
 * `last_name`.
 */
async function findFixtureContactId(accountId: string, contactName: string): Promise<string> {
  const lastName = contactName.split(" ").slice(1).join(" ");
  const { data, error } = await serviceDb().from("contacts")
    .select("id").eq("account_id", accountId).eq("last_name", lastName).single();
  if (error) throw new Error(`access-log spec: could not find the fixture contact "${contactName}": ${error.message}`);
  return (data as { id: string }).id;
}

/** Fills in one `{placeholder}` — this file never needs more than one per string. */
function fmt(template: string, value: string): string {
  return template.replace(/\{[a-zA-Z]+\}/, value);
}

test("a deep link meets the chooser, a reason returns it there, and the Owner reads what BIS opened", async ({ browser }) => {
  const fixture = fullFixture();
  const agency = agencyFixture();
  const contactId = await findFixtureContactId(fixture.accountId, fixture.contactName);
  const base = `/dashboard/accounts/${fixture.accountId}`;
  const deepLink = `${base}/contacts/${contactId}`;

  // 1. A new agency session: a fresh sign-in is a fresh Clerk session id, and
  // §3.3 ties a visit to the session that started it — this one has none yet.
  // `storageState: undefined` overrides the "chromium" project's own default
  // (`playwright.config.ts`'s AUTH_FILE, the shared agency session every other
  // spec in this project relies on) — without it, `browser.newContext()`
  // inherits that same signed-in session, and clerk.signIn's own
  // `SignIn.create()` refuses with "You're already signed in" because the
  // page it runs on is not actually blank.
  const agencyCtx = await browser.newContext({ storageState: undefined });
  try {
    const page = await agencyCtx.newPage();
    await clerkSetup();
    await signInWithTicket(page, await clerkClient(), agency.clerkUserId);
    await setActiveOrganization(page, agency.clerkOrgId);

    // 2. The deep link meets the chooser, not the contact: the gate redirects
    // BEFORE any record read, so nothing of the customer's is on this page.
    await page.goto(deepLink);
    await expect(page).toHaveURL(new RegExp(`/dashboard/enter/${fixture.accountId}\\?to=`));
    await expect(
      page.getByRole("heading", { name: fmt(m["accessLog.enter.heading"], fixture.companyName), exact: true }),
    ).toBeVisible();
    await expect(page.getByText(fixture.contactName)).toHaveCount(0);

    // 3. Choosing a reason round-trips through `x-bis-path` back to the deep
    // link it was headed for (spec §3.2's ASSUMPTION about the proxy header).
    await page.getByRole("button", { name: m["accessLog.reason.support"], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${deepLink}$`));
    await expect(recordPage(page).getByText(fixture.contactName).first()).toBeVisible();

    // 4. The drawer opens the SAME customer, in the SAME visit (review m9):
    // "one row per record per visit" has to hold across both entry points,
    // not just within one of them.
    await page.goto(`${base}/contacts`);
    const row = page.getByRole("row").filter({ hasText: fixture.contactName }).first();
    const summaryResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/accounts/${fixture.accountId}/contacts/${contactId}/summary`) && res.status() === 200,
    );
    await row.click();
    await summaryResponse;
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 5. No download from a prefetch (review C2/m5): hovering the Export link
    // (now a plain `<a download>`, never a next/link) must never reach the
    // export route — proven below by the ABSENCE of a download sentence on
    // the Owner's section, with the "Opened 1 customer." line as its positive
    // control.
    await page.getByRole("link", { name: m["contacts.export"] }).hover();
    await page.waitForLoadState("networkidle");
  } finally {
    await agencyCtx.close();
  }

  // 6. The Owner reads the visit on Team.
  const ownerCtx = await browser.newContext({ storageState: "e2e/.auth/client-state.json" });
  try {
    const page = await ownerCtx.newPage();
    await page.goto(`${base}/team#bis-access`);
    const section = page.locator("section#bis-access");
    const visitRow = section.locator("[data-bis-access-visit]").filter({ hasText: m["accessLog.reason.support"] });
    await expect(visitRow).toHaveCount(1);
    await expect(visitRow).toContainText("E2E Agency");
    await expect(visitRow).toContainText(fmt(m["accessLog.summary.opened"], m["accessLog.count.customersOne"]));

    await visitRow.getByRole("button", { name: m["accessLog.show"] }).click();
    const customerLink = visitRow.getByRole("link", { name: fmt(m["accessLog.item.customer"], fixture.contactName) });
    await expect(customerLink).toHaveCount(1);

    // The positive control above ("Opened 1 customer.") is what makes this
    // absence meaningful: the prefetch hover in step 5 wrote nothing.
    await expect(section).not.toContainText(m["accessLog.summary.downloadsOne"]);
    await expect(section.getByText(m["accessLog.note.lists"])).toBeVisible();
    await expect(section.getByText(m["accessLog.note.agencyLists"])).toBeVisible();
  } finally {
    await ownerCtx.close();
  }

  // 7. Staff cannot read it: the pre-existing Owner-only guard on Team
  // (staff-roles.spec.ts:150-155) redirects before the new section is ever a
  // question.
  const staffCtx = await browser.newContext({ storageState: "e2e/.auth/staff-state.json" });
  try {
    const page = await staffCtx.newPage();
    await page.goto(`${base}/team`);
    await expect(page).toHaveURL(new RegExp(`${base}/dashboard$`));
  } finally {
    await staffCtx.close();
  }
});
