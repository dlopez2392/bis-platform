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

    // The rail is chrome, and the two themes need DIFFERENT assertions. One
    // luminance probe across both was a NO-OP in dark: `.dark` sets
    // --sidebar-ground to `transparent`, so backgroundColor resolves to
    // "rgba(0, 0, 0, 0)", a /\d+/g regex reads that as r=g=b=0, and the
    // assertion passed unconditionally no matter what the rail rendered.
    //
    // LIGHT is the load-bearing half: --sidebar-ground is an opaque #0B0A12,
    // so backgroundColor IS the rail's real colour, and the claim worth making
    // is that the rail does NOT invert with the theme.
    //
    // DARK gets the contract instead: the rail is transparent ON PURPOSE so
    // the lit ground reads through (tokens.css says exactly that in its own
    // comment), and the visible wash comes from sidebar-chrome's
    // background-IMAGE, which getComputedStyle().backgroundColor never
    // reflects. Pinning the transparency is a real, falsifiable claim — give
    // the dark rail an opaque fill and the aurora stops showing through and
    // this fails.
    const railBg = await rail.evaluate((el) => getComputedStyle(el).backgroundColor);
    if (mode === "light") {
      // [\d.]+ , not \d+ : the old regex also dropped the fractional alpha, so
      // a fully transparent rail would have been read as opaque black.
      const channels = (railBg.match(/[\d.]+/g) ?? []).map(Number);
      expect(channels.length, `could not parse rail bg "${railBg}"`).toBeGreaterThanOrEqual(3);
      const [r = 255, g = 255, b = 255, a = 1] = channels;
      expect(a, `rail bg ${railBg} must be opaque in light`).toBe(1);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      expect(luminance, `rail bg ${railBg} must be dark in light mode`).toBeLessThan(0.3);
    } else {
      expect(railBg, "the dark rail must stay transparent so the lit ground reads through")
        .toMatch(/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$|^transparent$/);
    }

    // Both branches above read background-COLOR, and in dark that is
    // `transparent` whether the chrome applied or not — delete `sidebar-chrome`
    // from the rail's class list entirely and the dark assertion still passes,
    // on the browser's UA default, with no wash and no blur on screen. These
    // two close that hole: the gradient and the blur exist ONLY because the
    // utility landed, so they are what proves it did.
    const [railImage, railBlur] = await rail.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.backgroundImage, s.backdropFilter] as const;
    });
    expect(railImage, `the rail lost sidebar-chrome's wash in ${mode}`)
      .toContain("linear-gradient");
    if (mode === "dark") {
      // The VALUE, not the class. Lightning CSS once folded a hand-written
      // -webkit- twin into the prefixed form and dropped the standard property
      // outright: nothing blurred anywhere and the suite stayed green.
      expect(railBlur, "the dark rail must keep --glass-filter's blur").toBe("blur(14px)");
    }

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
