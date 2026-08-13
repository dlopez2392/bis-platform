import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess } from "@bis/db";
import { SEEDED_ACCOUNT_NAME, hexOf, paintedContrast } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// This spec is the milestone's only automated proof that one client cannot
// reach another client's data (design spec section 10). It drives five
// full navigations under the RLS-enforcing dbForRequest() path plus one
// direct DB write — the same order of per-page cost blueprints.spec.ts's
// own comment measures for this account-scoped route family, times five
// page loads instead of one.
//
// Fixture creation AND cleanup live outside this file: auth.setup.ts
// creates the Clerk user/org, the accounts row, and one seeded contact;
// auth.teardown.ts (a Playwright teardown project, see playwright.config.ts)
// deletes all of it afterward, unconditionally, so a filtered run that never
// selects this spec still cleans up what "setup" unconditionally created.
test.describe.configure({ timeout: 60_000 });

// Signed in as the client fixture auth.setup.ts creates, not the agency
// admin every other spec uses.
test.use({ storageState: "e2e/.auth/client-state.json" });

type ClientFixture = {
  accountId: string;
  clerkOrgId: string;
  clerkUserId: string;
  email: string;
  companyName: string;
  contactName: string;
  brandName: string;
  brandLogoPath: string;
  brandColor: string;
  formPublicId: string;
};

test("a client sees only their own account, and nothing when access is off", async ({ page }) => {
  const fixture = JSON.parse(
    readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
  ) as ClientFixture;
  const db = serviceDb();

  // 1. Signing in lands on their own account's dashboard — not the
  // accounts list. (dashboard)/page.tsx's resolveClientAccount() redirect
  // is what's under test here.
  await page.goto("/");
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard$`),
  );

  // 2. They can see their OWN data — the assertion the rest of this file
  // was missing. Every other check here is an absence check (no canary
  // name, no agency chrome, a redirect on the "off" case) and passes
  // trivially even if RLS/dbForRequest stopped returning this client's own
  // rows entirely: e.g. if [accountId]/layout.tsx's account lookup started
  // getting zero rows for a real account, it 404s via notFound(), which
  // renders *inside* this same dashboard/layout.tsx shell — sidebar still
  // present, URL unchanged, no leaked name to find — and every assertion
  // below would still pass while the client's whole CRM was a 404. Seeing
  // their own seeded contact is the only way this file can fail on that.
  await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts`);
  await expect(page.getByText(fixture.contactName)).toBeVisible();

  // 3. The sidebar shows exactly the six in-account items, and no "Back
  // to agency", Blueprints, Settings, or account switcher.
  const navLinks = page.locator("aside nav a");
  await expect(navLinks).toHaveCount(6);
  for (const label of [
    "Dashboard", "Contacts", "Opportunities", "Conversations", "Forms", "Calendar",
  ]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Blueprints", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to companies", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Switch company" })).toHaveCount(0);

  // The client must still be able to tell WHICH company they are in. Hiding
  // the switcher above removed the only element that displayed the account
  // name, so a client saw nothing but the agency's own "BIS" branding and
  // could not identify the account. Every other assertion in this file is
  // about what should be ABSENT, which is exactly why that shipped unnoticed
  // — this is the one that fails if the name disappears again.
  //
  // M3 replaces the assertion PR #8 added here rather than sitting beside it.
  // That one checked for the *account* name; branding now takes precedence, so
  // keeping both would leave two assertions contradicting each other about the
  // same slot. brandName is a distinct string from companyName in the fixture
  // precisely so this can tell which column the sidebar actually read.
  const sidebar = page.locator("aside");
  await expect(sidebar.getByText(fixture.brandName, { exact: true })).toBeVisible();
  await expect(sidebar.getByText(fixture.companyName, { exact: true })).toHaveCount(0);

  // The logo, and proof a customer's browser can actually load it — the src
  // being right is not the same as the bytes being reachable. This is served
  // from a public Storage bucket, so an anonymous GET is the real test.
  const logo = sidebar.locator("img");
  await expect(logo).toBeVisible();
  const logoSrc = await logo.getAttribute("src");
  expect(logoSrc).toContain(fixture.brandLogoPath);
  const logoRes = await page.request.get(logoSrc!);
  expect(logoRes.status()).toBe(200);

  // Computed style, not a class name: a class assertion passes while the
  // custom property is unset, which is exactly the failure being guarded.
  // #1e3a8a scores 1.62:1 on the dark sidebar and is lightened to #3a62d4 to
  // clear 3:1 — so this value ALSO proves the lightening ran.
  await expect(sidebar.locator("nav span.bg-sidebar-accent").first())
    .toHaveCSS("background-color", "rgb(58, 98, 212)");

  // The agency's own name must be gone from the client's chrome entirely.
  // This is the milestone's headline promise, and the one thing danlo flagged
  // from live QA: "the only branding says BIS — the AGENCY's name".
  await expect(sidebar.getByText("BIS", { exact: true })).toHaveCount(0);

  // Including the browser tab, which the app does not draw but does control,
  // and which read "BIS Platform" on every screen a client ever saw.
  await expect(page).toHaveTitle(fixture.brandName);

  // 4. Navigating to another account's URL redirects to their own
  // account, and the other account's data never renders. "Test Client
  // One" is the one account in this environment seeded with real,
  // recognizable data (support.ts) — a good canary for a leak.
  const { data: other, error: otherErr } = await db
    .from("accounts")
    .select("id")
    .eq("name", SEEDED_ACCOUNT_NAME)
    .single();
  if (otherErr || !other) {
    throw new Error(`client-access spec: seeded account lookup failed: ${otherErr?.message}`);
  }
  await page.goto(`/dashboard/accounts/${other.id}/contacts`);
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard$`),
  );
  await expect(page.getByText("Maria Garcia")).toHaveCount(0);

  // 5. The activation checklist panel does not appear on their dashboard
  // — it's agency work about the client, not client data (design
  // spec section 6.1). The fixture account is brand new, so every
  // catalogue item is still pending; if the isAgency gate around the
  // panel in [accountId]/dashboard/page.tsx were ever dropped, this
  // account is guaranteed to have a panel to show.
  await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
  await expect(page.getByText("Activation checklist")).toHaveCount(0);

  // 6. With client_access_enabled flipped false, they get the no-access
  // page — not an empty CRM. This is what proves design spec sections
  // 3.3 and 8 are real rather than cosmetic: without the app-level
  // redirect, RLS's own client_access_enabled check in
  // app.current_account_id() (migration 0008) would independently zero
  // out every query on this page, producing a fully-rendered dashboard
  // with every stat reading 0 — exactly the "empty but fully functional
  // CRM" failure mode the design calls out as worse than an error.
  //
  // Deliberately not restored to true here, and the fixture row is not
  // deleted here either — auth.teardown.ts restores the flag and deletes
  // every row/identity this fixture created, unconditionally, whether or
  // not this assertion (or any above it) fails.
  await setClientAccess(db, fixture.accountId, false, fixture.clerkUserId);
  await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
  await expect(page).toHaveURL(/\/no-access\?reason=off$/);
  await expect(page.getByText("Access has been turned off")).toBeVisible();
});

// The client's own CUSTOMERS — people with no relationship to BIS at all, and
// the audience this milestone ultimately exists for.
test.describe("the public lead form wears the client's brand", () => {
  // Explicitly no storage state. The file-level test.use above signs in as the
  // client fixture, and reusing that here would prove nothing about what an
  // anonymous visitor sees — which is the only thing this page ever serves.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an anonymous visitor sees the company's brand above the form", async ({ page }) => {
    const fixture = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as ClientFixture;

    await page.goto(`/f/${fixture.formPublicId}`);

    // The form itself still renders — otherwise a 404 would satisfy every
    // "BIS is absent" check below without proving anything.
    await expect(page.locator(".bis-form form")).toBeVisible();

    await expect(page.getByText(fixture.brandName, { exact: true })).toBeVisible();
    const logo = page.locator(".bis-form-brand-logo");
    await expect(logo).toBeVisible();
    const logoSrc = await logo.getAttribute("src");
    expect(logoSrc).toContain(fixture.brandLogoPath);
    expect((await page.request.get(logoSrc!)).status()).toBe(200);

    // This used to assert the brand colour arrived RAW here — `rgb(30, 58,
    // 138)`, "as chosen, unlightened", against the sidebar's lightened copy.
    // M4b ended that: the fixture is a themed tenant (warm / dark) and
    // #1e3a8a scores 1.64:1 on its own dark background, so the CTA is lifted
    // for the surfaces it actually lands on. The unlifted value is still
    // pinned — it moved to public-form-theme.spec.ts, which asserts it on an
    // account with no theme controls set, where it remains exactly true.
    //
    // What belongs in THIS spec is the milestone's own claim: the client's
    // brand reaches their customers' page, and it is readable there. Both are
    // measured rather than compared to a literal, so the assertion cannot be
    // satisfied by freezing whichever hex the derivation currently returns.
    const submit = page.locator(".bis-form-submit");
    const fill = await submit.evaluate((el) => getComputedStyle(el).backgroundColor);
    const label = await submit.evaluate((el) => getComputedStyle(el).color);
    const canvas = await page.locator("main").evaluate((el) => getComputedStyle(el).backgroundColor);

    // BIS violet is what an account with no brand colour gets. Anything else
    // means this company's own colour reached the page their customers load.
    expect(hexOf(fill)).not.toBe("#6d28d9");
    // WCAG 1.4.11 for the button itself, 1.4.3 for the word inside it.
    expect(paintedContrast(fill, canvas)).toBeGreaterThanOrEqual(3);
    expect(paintedContrast(label, fill)).toBeGreaterThanOrEqual(4.5);

    // Neither the agency's name nor the agency's internal label for this
    // company belongs on a page their customers see.
    await expect(page.getByText("BIS", { exact: true })).toHaveCount(0);
    await expect(page.getByText(fixture.companyName, { exact: true })).toHaveCount(0);
  });
});
