import { test, expect } from "@playwright/test";

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
  await page.goto("/dashboard/accounts");
  await page.getByRole("button", { name: "Switch company" }).click();
  const first = page.getByRole("option").first();
  await first.click();
  await expect(page).toHaveURL(/\/dashboard\/accounts\/[^/]+\/contacts/);
});

// The agency's sidebar keeps the globals.css accent — brand colors are a
// client-only override. client-access.spec.ts pins the branded case
// (rgb(58, 98, 212), a lightened brand); this pins the no-op branch, which is
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
