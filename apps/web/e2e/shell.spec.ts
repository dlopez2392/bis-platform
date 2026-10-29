import { test, expect } from "./fixtures/test";
import { readClientFixture } from "./support";

/** For a RegExp built from the fixture's own name (contact-detail.spec.ts's own helper). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("sidebar collapse persists across reload", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  // Leave the sidebar expanded again so later specs (and reruns) start from
  // a known state instead of inheriting this test's cookie.
  await page.getByRole("button", { name: "Expand sidebar" }).click();
});

test("account switcher navigates into a company", async ({ page }) => {
  // F-118 part 1 (review I4): the first (newest) option in a shared project
  // can be ANY company, including one this agency session has given no
  // reason for yet — the gate would then leave the click on the chooser
  // instead of /contacts. Read at run time, as access-log.spec.ts does: the
  // "setup" project writes this file before any spec runs, and its own
  // agency-visit setup test (auth.setup.ts) already gave the per-run fixture
  // a reason, so picking it BY NAME keeps this spec testing the switcher,
  // never the gate.
  const fixture = readClientFixture();
  if (!fixture) {
    throw new Error(
      "account switcher spec: no client fixture at e2e/.auth/client-fixture.json — " +
      "the \"setup\" project did not run. Run the full suite: pnpm --filter web test:e2e.",
    );
  }
  await page.goto("/dashboard/accounts");
  await page.getByRole("button", { name: "Switch company" }).click();
  const option = page.getByRole("option", { name: new RegExp(escapeRegExp(fixture.companyName)) });
  await option.click();
  await expect(page).toHaveURL(/\/dashboard\/accounts\/[^/]+\/contacts/);
});

// The agency's sidebar keeps the globals.css accent — brand colors are a
// client-only override. client-access.spec.ts pins the branded case
// (rgb(49, 91, 210), a lightened brand); this pins the no-op branch, which is
// otherwise verified only by reading. Computed style, not a class name: a
// class assertion passes whether or not the custom property was set.
test("the agency sidebar keeps the default accent", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  // The rail is a two-stop gradient (app-sidebar.tsx) — see client-access
  // .spec.ts's identical note. The locator keys on `data-slot="nav-rail"`,
  // not the old `bg-sidebar-accent` class: that class is shared by the
  // unread-count badge and the collapsed-state dot too. Both stops are
  // pinned for the BIS default because Task 2 of the Northern Lights branch
  // routed `--sidebar-accent` to the chrome tint (`--sidebar-tint` #8B7CF7,
  // `--sidebar-tint-2` #4FD8E6 — both themes).
  await expect(page.locator('aside nav [data-slot="nav-rail"]').first())
    .toHaveCSS("background-image", "linear-gradient(rgb(139, 124, 247), rgb(79, 216, 230))");
});
