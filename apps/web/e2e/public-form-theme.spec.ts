import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setBranding, updateForm, getPublishedFormByPublicId,
         type FormTheme } from "@bis/db";
import { NEUTRAL_RAMPS } from "../src/lib/branding/neutral-ramps";
import { paintedContrast } from "./support";

// Same two paths, same reason, as tenant-theme.spec.ts and auth.setup.ts: this
// file calls serviceDb() from the Playwright runner process, not through a
// Next request, so nothing auto-loads the env for it.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

type ClientFixture = { accountId: string; clerkUserId: string; formPublicId: string };

function readClientFixture(): ClientFixture {
  return JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;
}

/**
 * What auth.setup.ts sets, restated here as the value to restore TO.
 *
 * Three of these tests have to change the account's branding to reach the
 * case they are about — there is one fixture account and four mutually
 * exclusive themes to cover. Each restores in a `finally`, because
 * auth.teardown only runs when a suite COMPLETES: a killed run would
 * otherwise leave the fixture in a state tenant-theme.spec.ts silently
 * depends on, and that spec would fail for a reason with no relation to it.
 */
const FIXTURE_THEME = {
  brandNeutral: "warm", brandCorners: "round", brandType: "serif", brandMode: "dark",
} as const;

const UNTHEMED = {
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
} as const;

/**
 * What the element is actually PAINTED with, never the custom property it
 * carries. Reading `--background` back is what let four green M4a tests sit
 * on top of a page that was still entirely BIS: the property was genuinely
 * set, and genuinely consumed by nobody.
 */
const painted = (
  selector: string,
  name: "background-color" | "color" | "font-family" | "border-radius" | "outline-color",
) => (page: Page) =>
  page.locator(selector).first().evaluate(
    (el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name,
  );

/** `#12100e` → `rgb(18, 16, 14)`, the form getComputedStyle reports. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

// Anonymous, deliberately: /f/<publicId> is the one surface in this product a
// stranger loads with no session at all, which also makes it the cheapest one
// to test honestly.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("the public form wears the tenant theme", () => {
  test("a themed tenant's form paints their surfaces, corners and typeface", async ({ page }) => {
    const fixture = readClientFixture();
    await page.goto(`/f/${fixture.formPublicId}`);

    // The fixture is warm / round / serif / dark with brand colour #1e3a8a.
    expect(await painted("main", "background-color")(page)).toBe(rgb(NEUTRAL_RAMPS.warm.dark.bg));
    expect(await painted(".bis-form", "color")(page)).toBe(rgb(NEUTRAL_RAMPS.warm.dark.fg));
    expect(await painted(".bis-form", "font-family")(page)).toMatch(/source.serif/i);
    // The input fill is the card step, and its own corner radius proves
    // `--radius` reaches something that paints. round = 1rem = 16px.
    expect(await painted("input[type='email']", "background-color")(page))
      .toBe(rgb(NEUTRAL_RAMPS.warm.dark.card));
    expect(await painted(".bis-form-submit", "border-radius")(page)).toBe("16px");

    // The CTA is #1e3a8a lifted: 1.64:1 on this tenant's own dark background
    // unlifted, so an unlifted value here would mean the guarantee never ran.
    // Measured, not compared to a hex — a literal would freeze whichever
    // answer the derivation happens to give and stop proving the property.
    const cta = await painted(".bis-form-submit", "background-color")(page);
    const label = await painted(".bis-form-submit", "color")(page);
    expect(cta).not.toBe(rgb("#1e3a8a"));
    expect(paintedContrast(cta, rgb(NEUTRAL_RAMPS.warm.dark.bg))).toBeGreaterThanOrEqual(3);
    expect(paintedContrast(label, cta)).toBeGreaterThanOrEqual(4.5);
  });

  test("an unthemed account renders what this page rendered before M4b", async ({ page }) => {
    const fixture = readClientFixture();
    const db = serviceDb();
    await setBranding(db, fixture.accountId, UNTHEMED, fixture.clerkUserId);
    try {
      await page.goto(`/f/${fixture.formPublicId}`);

      // No token set at all: form.css's own fallbacks are what paint, and the
      // page keeps showing the browser canvas through <main>.
      expect(await painted("main", "background-color")(page)).toBe(TRANSPARENT);
      expect(await painted(".bis-form", "color")(page)).toBe(rgb("#18181b"));
      expect(await painted(".bis-form", "font-family")(page)).toContain("system-ui");
      expect(await painted("input[type='email']", "background-color")(page)).toBe(rgb("#ffffff"));
      expect(await painted(".bis-form-submit", "border-radius")(page)).toBe("8px");
      // The brand colour still reaches the CTA with no theme engaged — that
      // is what brand_color alone has always done, and M4b does not change it.
      expect(await painted(".bis-form-submit", "background-color")(page)).toBe(rgb("#1e3a8a"));
    } finally {
      await setBranding(db, fixture.accountId, FIXTURE_THEME, fixture.clerkUserId);
    }
  });

  test("a transparent embed keeps the host page's backdrop and takes no surfaces", async ({ page }) => {
    const fixture = readClientFixture();
    const db = serviceDb();
    const form = (await getPublishedFormByPublicId(db, fixture.formPublicId))!;
    const original: FormTheme = form.theme ?? {};
    await updateForm(db, fixture.accountId, form.id,
      { theme: { ...original, transparentBackground: true } }, fixture.clerkUserId);
    try {
      await page.goto(`/f/${fixture.formPublicId}`);

      // A dark-mode tenant who also checks `transparent` would otherwise paint
      // near-white text onto a white host page and the form would vanish.
      expect(await painted("main", "background-color")(page)).toBe(TRANSPARENT);
      expect(await painted(".bis-form", "background-color")(page)).toBe(TRANSPARENT);
      expect(await painted(".bis-form", "color")(page)).toBe(rgb("#18181b"));
      expect(await painted("input[type='email']", "background-color")(page)).toBe(rgb("#ffffff"));

      // Corners and typeface still come from the tenant: neither depends on
      // knowing what the host page's backdrop is.
      expect(await painted(".bis-form-submit", "border-radius")(page)).toBe("16px");
      expect(await painted(".bis-form", "font-family")(page)).toMatch(/source.serif/i);
    } finally {
      await updateForm(db, fixture.accountId, form.id, { theme: original }, fixture.clerkUserId);
    }
  });

  test("a follow tenant paints dark on a dark device and light on a light one", async ({
    browser, baseURL,
  }) => {
    const fixture = readClientFixture();
    const db = serviceDb();
    await setBranding(db, fixture.accountId, { ...FIXTURE_THEME, brandMode: "follow" },
      fixture.clerkUserId);
    try {
      // Two real browser contexts, because this is the one thing a server
      // cannot answer: `follow` resolves in the visitor's own device. The
      // light half is not a formality — the dark declarations carry
      // `!important` (they have to outrank the inline style attribute they
      // share an element with), so a mis-scoped rule would paint dark for
      // everyone and only this half would notice.
      for (const [scheme, expected] of [
        ["dark", NEUTRAL_RAMPS.warm.dark.bg],
        ["light", NEUTRAL_RAMPS.warm.light.bg],
      ] as const) {
        const context = await browser.newContext({ colorScheme: scheme, baseURL });
        try {
          const page = await context.newPage();
          await page.goto(`/f/${fixture.formPublicId}`);
          expect(await painted("main", "background-color")(page), `${scheme} device`)
            .toBe(rgb(expected));
          expect(await painted(".bis-form", "color")(page), `${scheme} device text`)
            .toBe(rgb(NEUTRAL_RAMPS.warm[scheme].fg));
        } finally {
          await context.close();
        }
      }
    } finally {
      await setBranding(db, fixture.accountId, FIXTURE_THEME, fixture.clerkUserId);
    }
  });
});
