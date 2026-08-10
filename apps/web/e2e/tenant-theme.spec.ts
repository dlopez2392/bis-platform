import { test, expect, type Page, type BrowserContextOptions } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess } from "@bis/db";
import { NEUTRAL_RAMPS } from "../src/lib/branding/neutral-ramps";

// Same two paths, same reason, as client-access.spec.ts and auth.setup.ts: this
// file calls serviceDb() from the Playwright runner process, not through a
// Next request, so nothing auto-loads the env for it.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// Fixture creation AND cleanup live outside this file: auth.setup.ts creates
// the Clerk user/org, the accounts row, and its branding (brand_neutral:
// "warm", brand_corners: "round", brand_mode: "dark" -- see the setBranding
// call there); auth.teardown.ts deletes all of it afterward, unconditionally,
// so a filtered run that never selects this spec still cleans up what
// "setup" unconditionally created. Read inline in each test body, not at
// module scope: Playwright loads every *.spec.ts matched by any project
// (including "chromium", which matches this file) during collection, before
// the "setup" project's own tests have run and written the fixture to disk.
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

function readClientFixture(): ClientFixture {
  return JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;
}

// Computed style, not a class name: a class proves a string was written, not
// that anything reached the renderer.
const prop = (selector: string, name: string) => (page: Page) =>
  page.locator(selector).first().evaluate(
    (el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name,
  );

// This spec's own precondition, established rather than assumed.
//
// client-access.spec.ts ends by turning the fixture account's client access
// OFF and deliberately does not restore it — auth.teardown.ts deletes the whole
// fixture afterwards, so from that spec's point of view there is nothing to
// clean up. But "tenant-theme" sorts after "client-access", so on a full run
// this file inherited a disabled account: every client page rendered
// /no-access?reason=off, no shell was ever mounted, and all three client tests
// timed out waiting for an element that could not exist. The failure looked
// like the theme was broken when the session was.
//
// A spec that depends on another spec's leftover state is a spec that passes or
// fails on filename order. This puts the account back into the state these
// tests are about.
test.beforeAll(async () => {
  const fixture = readClientFixture();
  await setClientAccess(serviceDb(), fixture.accountId, true, fixture.clerkUserId);
});

test.describe("tenant theme", () => {
  // Signed in as the client fixture auth.setup.ts creates, not the agency
  // admin every other spec uses.
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client's workspace paints its tenant's derived tokens", async ({ page }) => {
    const fixture = readClientFixture();
    await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts`);

    const bg = await prop("[data-tenant-theme]", "--background")(page);
    expect(bg).toBe(NEUTRAL_RAMPS.warm.dark.bg);

    const radius = await prop("[data-tenant-theme]", "--radius")(page);
    expect(radius).toBe("1rem");

    // #1e3a8a scores 1.62:1 on a dark sidebar, so an unlifted value here
    // would mean the guarantee never ran.
    const accent = await prop("[data-tenant-theme]", "--sidebar-accent")(page);
    expect(accent).not.toBe("#1e3a8a");
  });

  test("the topbar toggle beats the tenant default and survives a reload", async ({ page }) => {
    const fixture = readClientFixture();
    await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts`);
    await page.getByTestId("theme-toggle").click();

    await expect.poll(() => prop("[data-tenant-theme]", "--background")(page))
      .toBe(NEUTRAL_RAMPS.warm.light.bg);

    // The reload is the point. localStorage alone would repaint on mount;
    // only the cookie makes the SERVER emit the light set.
    await page.reload();
    expect(await prop("[data-tenant-theme]", "--background")(page))
      .toBe(NEUTRAL_RAMPS.warm.light.bg);
  });
});

test.describe("agency chrome", () => {
  // No test.use override here: the default storageState from
  // playwright.config.ts (the agency admin) applies, matching how
  // client-access.spec.ts leaves its own agency-scoped checks on the config
  // default and overrides only for the client and anonymous cases.
  test("carries no tenant theme at all", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    // The absence IS the assertion. "BIS by construction" is otherwise just
    // a comment about there being no branch to invert.
    await expect(page.locator("[data-tenant-theme]")).toHaveCount(0);
  });
});

// The Critical a unit test could never see: the root layout and the
// dashboard shell used to each resolve the paint mode separately, so a
// cookie-less request for a tenant whose brand_mode is "dark" got no `.dark`
// class on <html> while the shell emitted dark-derived tokens anyway -- and
// the cookie-sync effect then persisted "light", permanently overriding the
// tenant's configured default on the very first visit. Both layouts now go
// through one shared getRequestTheme (tenant-theme-reader.ts), but nothing
// had ever exercised that fix in a browser until this test.
test.describe("tenant theme default with no cookie yet", () => {
  test("a cookie-less request paints the tenant's dark default and the cookie keeps it", async ({
    browser, baseURL,
  }) => {
    const fixture = readClientFixture();

    type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;
    const saved = JSON.parse(
      readFileSync("e2e/.auth/client-state.json", "utf-8"),
    ) as StorageState;
    // The saved state already carries a bis-theme cookie -- the fixture's own
    // first visit in auth.setup.ts resolved a mode and the cookie-sync effect
    // wrote it before the state was captured. Stripping it here reproduces
    // the literal absence a brand-new (or cleared) browser sends, which is
    // the one condition the fixed code path had never been driven through.
    const cookieless: StorageState = {
      ...saved,
      cookies: saved.cookies.filter((c) => c.name !== "bis-theme"),
    };

    const context = await browser.newContext({ storageState: cookieless, baseURL });
    try {
      const page = await context.newPage();
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts`);

      // The two facts that must agree: <html> carries the dark class (the
      // root layout's half) AND the shell's own computed background is the
      // warm ramp's dark background (the shell's half). Before the fix, the
      // root layout was handed a hardcoded `null` instead of this tenant's
      // real mode, so it resolved light while the shell -- reading the real
      // brand_mode -- painted dark tokens underneath a light <html>.
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      const bg = await prop("[data-tenant-theme]", "--background")(page);
      expect(bg).toBe(NEUTRAL_RAMPS.warm.dark.bg);

      // The half that was silently broken, and the assertion is the opposite
      // of what it first looked like. The cookie carries the USER's own answer.
      // This tenant said "dark" outright, which the server already knows and
      // re-reads on every request, so nothing should write a cookie at all —
      // and an earlier version wrote one on every route, including /sign-in
      // where there is no tenant and the answer came out "light". That cookie
      // then outranked brand_mode forever, so a company that chose a dark
      // default never saw one.
      //
      // Absence is therefore the correct end state. Asserted after a settle
      // and a reload, because the failure mode was a write that happened one
      // tick late and survived the next navigation.
      await page.waitForTimeout(500);
      await page.reload();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      const themeCookie = (await context.cookies()).find((c) => c.name === "bis-theme");
      expect(themeCookie, "a tenant default must not be echoed back as a user choice").toBeUndefined();
      expect(await prop("[data-tenant-theme]", "--background")(page))
        .toBe(NEUTRAL_RAMPS.warm.dark.bg);
    } finally {
      await context.close();
    }
  });
});
