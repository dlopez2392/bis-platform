import { test, expect } from "./fixtures/test";
import { readClientFixture } from "./support";

/**
 * F-014's +35% pseudo-locale overflow check (DESIGN.md DoD: "survives the
 * pseudo-locale's +35% length") on Spanish-runtime's two proof screens.
 *
 * QA-only: `?locale=pseudo` only does anything when `BIS_I18N_QA=1` is set
 * (`requestPseudoMode`, lib/i18n/request-locale.ts) — Playwright's own
 * `webServer.env` and CI's `e2e` job set it; a Vercel deployment never does,
 * so this query param is dead weight there, never a live override.
 *
 * READ-ONLY. Neither test mutates anything, but the dashboard check still
 * goes through the per-run fixture account (`support.ts`'s
 * `readClientFixture()`) rather than the shared seeded `Test Client One`,
 * per this lane's own fixture discipline — not because this spec writes to
 * it, but so it never depends on `Test Client One`'s real, operator-edited
 * state staying shaped a particular way.
 *
 * What each assertion actually measures: `scrollWidth > clientWidth` on the
 * tile/label box itself — the DOM's own overflow signal, not a visual diff.
 * `scrollWidth` is the box's full, unclipped content width; `clientWidth` is
 * what it was actually given. The pseudo-locale's accented vowels plus the
 * `Ẋẋ`/`Ṿṿ` padding words are ~35% longer than the real English string, so a
 * tile/label whose CSS doesn't truncate or wrap would clip under them and
 * this comparison would catch it directly (no screenshot, no pixel diff).
 */

test.describe("pseudo-locale overflow (F-014)", () => {
  test("dashboard KPI tiles do not clip under the pseudo-locale", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json — the setup project creates it; run the full suite.");
      return;
    }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard?locale=pseudo`);
    const tiles = page.locator("[data-slot='stat-tile']");
    const count = await tiles.count();
    expect(count, "no stat tiles found — confirm the fixture account and the data-slot value before trusting the loop below").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const el = tiles.nth(i);
      const [scrollW, clientW] = await el.evaluate((n) => [n.scrollWidth, n.clientWidth]);
      expect(scrollW, `stat tile ${i} overflows its card`).toBeLessThanOrEqual(clientW);
    }
  });

  test("styleguide's pseudo-locale nav-label column does not clip (sidebar proof, run here because the account layout cannot see ?locale= — see Task 11's own brief note)", async ({ page }) => {
    await page.goto("/dashboard/styleguide?locale=pseudo");
    const labels = page.locator("[data-nav-label='pseudo']");
    const count = await labels.count();
    expect(count, "no pseudo-locale nav labels found — confirm the styleguide's third column shipped").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const el = labels.nth(i);
      const [scrollW, clientW] = await el.evaluate((n) => [n.scrollWidth, n.clientWidth]);
      expect(scrollW, `pseudo-locale nav label ${i} overflows its box`).toBeLessThanOrEqual(clientW);
    }
  });
});
