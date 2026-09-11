import { test, expect } from "@playwright/test";

// Explicitly no storage state. playwright.config.ts gives the "chromium"
// project the agency's saved session, and every assertion in this file is
// about what a person who is NOT signed in sees. Same idiom as
// client-access.spec.ts's public-form describe.
test.use({ storageState: { cookies: [], origins: [] } });

// The mode a signed-out request paints comes from ONE place: the bis-theme
// cookie (resolveThemeMode(cookie, null) — there is no tenant to ask). There
// is deliberately no theme toggle on these screens, so setting the cookie is
// how a test reaches dark, and it is also exactly what a returning user who
// once clicked the toggle arrives with.
const THEME_COOKIE = "bis-theme";

async function visit(
  page: import("@playwright/test").Page,
  baseURL: string | undefined,
  path: string,
  mode: "light" | "dark",
) {
  if (mode === "dark") {
    await page.context().addCookies([
      { name: THEME_COOKIE, value: "dark", url: baseURL ?? "http://localhost:3000" },
    ]);
  }
  await page.goto(path);
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${mode}\\b`));
}

for (const mode of ["light", "dark"] as const) {
  test(`/no-access renders through the shell in ${mode}`, async ({ page, baseURL }) => {
    await visit(page, baseURL, "/no-access", mode);

    // MEASURED, not queried. The dashboard checklist's meter shipped as a
    // 0x0 inline element and passed every presence check there was, in both
    // themes, at every value. A locator being "visible" is not a box.
    const rail = page.locator('[data-slot="auth-rail"]');
    await expect(rail).toBeVisible();
    const box = await rail.boundingBox();
    expect(box, "the rail has no box at all").not.toBeNull();
    expect(box!.width, `rail width in ${mode}`).toBeGreaterThan(0);
    expect(box!.height, `rail height in ${mode}`).toBeGreaterThan(0);

    const mark = page.locator('[data-slot="bis-mark"]');
    const markBox = await mark.boundingBox();
    expect(markBox, "the mark has no box at all").not.toBeNull();
    expect(markBox!.width, `mark width in ${mode}`).toBeGreaterThan(0);

    // The rail is chrome: dark in BOTH themes. Same luminance probe
    // theme.spec.ts uses on the real sidebar.
    const railBg = await rail.evaluate((el) => getComputedStyle(el).backgroundColor);
    const channels = (railBg.match(/\d+/g) ?? []).map(Number);
    expect(channels.length, `could not parse rail bg "${railBg}"`).toBeGreaterThanOrEqual(3);
    const [r = 255, g = 255, b = 255] = channels;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    expect(luminance, `rail bg ${railBg} must be dark in ${mode}`).toBeLessThan(0.3);

    // No theme toggle on a signed-out screen, ever (spec §6). This is not a
    // style preference: theme-mode.ts records a shipped bug where a cookie
    // written at /sign-in — a route with no tenant, so it resolves light —
    // outranked every tenant's brand_mode permanently, and a company that
    // chose a dark default never saw one. A toggle here re-opens that path.
    await expect(page.getByTestId("theme-toggle")).toHaveCount(0);

    // The page's own content survived the move into the shell.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
}

test("the rail collapses to a brand bar on a phone", async ({ page, baseURL }) => {
  // Spec §4.2. Below 640px the card is one column and the rail is a bar
  // across the top, so the form keeps full width. Asserted by GEOMETRY, not
  // by the presence of a Tailwind class: `sm:flex-row` being in the class
  // attribute proves the string was typed, not that the layout responded.
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, baseURL, "/no-access", "light");

  const rail = page.locator('[data-slot="auth-rail"]');
  const narrow = await rail.boundingBox();
  expect(narrow, "the rail has no box at 390px").not.toBeNull();
  // A bar spans the card. Asserted against a width the 200px column cannot
  // reach, rather than against its own height — the rail stretches to the
  // card, so a height comparison would ride on how tall THIS page's content
  // happens to be and could flip on a page with one line less.
  expect(narrow!.width, "the rail should span the card below 640px").toBeGreaterThan(300);

  await page.setViewportSize({ width: 1280, height: 800 });
  const wide = await rail.boundingBox();
  expect(wide, "the rail has no box at 1280px").not.toBeNull();
  expect(wide!.width, "the rail should be the 200px column above 640px")
    .toBeLessThan(230);
});
