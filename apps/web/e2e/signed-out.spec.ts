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

  test(`/ renders through the shell in ${mode}`, async ({ page, baseURL }) => {
    await visit(page, baseURL, "/", mode);

    const rail = page.locator('[data-slot="auth-rail"]');
    const box = await rail.boundingBox();
    expect(box, "the rail has no box at all").not.toBeNull();
    expect(box!.width, `rail width in ${mode}`).toBeGreaterThan(0);

    // Copy is unchanged by this work — if it moved, that is a regression, not
    // a redesign.
    await expect(
      page.getByRole("heading", { name: "BIS Platform" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test(`/sign-in wears the shell and the restyled Clerk form in ${mode}`, async ({ page, baseURL }) => {
    await visit(page, baseURL, "/sign-in", mode);

    const rail = page.locator('[data-slot="auth-rail"]');
    const box = await rail.boundingBox();
    expect(box, "the rail has no box at all").not.toBeNull();
    expect(box!.width, `rail width in ${mode}`).toBeGreaterThan(0);
    expect(box!.height, `rail height in ${mode}`).toBeGreaterThan(0);

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // Clerk's own form still works. Without this, every assertion above is
    // satisfied by a page that renders a beautiful shell around nothing.
    const email = page.getByLabel(/email/i).first();
    await expect(email).toBeVisible();
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();

    // Anchored, NOT /continue/i: the Google button reads "Continue with
    // Google" and matches a loose regex too, and it comes first in the DOM —
    // so `.first()` on a loose match would probe the wrong button and pass
    // for the wrong reason.
    const submit = page.getByRole("button", { name: /^Continue$/ });
    await expect(submit).toBeVisible();
    const bg = await submit.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg, `the primary button in ${mode} is not painting --gradient-primary`)
      .toContain("linear-gradient");

    // A SECOND element and a different KIND of property, because "we passed a
    // style" is not "it computed". Clerk sets a 6px radius of its own here, so
    // this is a value we can only be reading because ours won.
    const inputRadius = await email.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(inputRadius, `the email input kept Clerk's radius in ${mode}`).toBe("8px");

    // THESE GO LAST, and the position is the whole point. Every assertion
    // above already waited for Clerk's form to mount, so by here the page has
    // settled and these measure the finished DOM.
    //
    // Both are negative, web-first assertions — they resolve the instant they
    // observe a passing value and stop polling — which makes them blind to
    // anything Clerk adds late. The heading count proved it: written directly
    // under the "Sign in" assertion, it passed 5/5 against a build that
    // genuinely rendered two headings, because ours is server-rendered and
    // Clerk's mounts 600ms–2.5s later. It counted 1 before the duplicate
    // existed. An assertion that runs before the thing it measures can appear
    // is not a guard, and `not.toHaveAttribute` has exactly the same shape.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // Nobody is authenticated here, so there is no tenant and the root layout
    // must not have painted one. This is what keeps a future "let's brand
    // sign-in per client" change honest — and that change would add the
    // attribute CLIENT-side, which is precisely what this could not have seen
    // from its original position above.
    await expect(page.locator("body")).not.toHaveAttribute("data-tenant-theme");

    // The card is FLATTENED, not restyled — DESIGN.md rule 2, and the one
    // finding that actually rendered wrong on the page: with class names
    // Clerk kept its own background, shadow and 32px padding, so a card sat
    // inside the shell's card. A third probe, on a third element and a third
    // kind of property, because the type system provably cannot catch a
    // mistyped element key here (see the page's own note) — these probes are
    // the only thing that can.
    const clerkCard = page.locator(".cl-card").first();
    const cardStyle = await clerkCard.evaluate((el) => {
      const s = getComputedStyle(el);
      return { padding: s.padding, shadow: s.boxShadow };
    });
    expect(cardStyle.padding, `Clerk's card kept its own padding in ${mode}`).toBe("0px");
    expect(cardStyle.shadow, `Clerk's card kept its own shadow in ${mode}`).toBe("none");
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
