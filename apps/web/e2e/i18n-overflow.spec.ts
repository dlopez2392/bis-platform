import { test, expect } from "./fixtures/test";
import { readClientFixture } from "./support";
import { clipFailure, pseudoTitleFallbackFailure } from "./overflow-check";

/**
 * F-014's +35% pseudo-locale overflow check (DESIGN.md DoD: "survives the
 * pseudo-locale's +35% length") on Spanish-runtime's two proof screens.
 *
 * QA-only: `?locale=pseudo` only does anything when `BIS_I18N_QA=1` is set
 * (`requestPseudoMode`, lib/i18n/request-locale.ts) — Playwright's own
 * `webServer.env` and CI's `e2e` job set it; a Vercel deployment never does,
 * so this query param is dead weight there, never a live override.
 *
 * READ-ONLY. No test here mutates anything, but the dashboard check still
 * goes through the per-run fixture account (`support.ts`'s
 * `readClientFixture()`) rather than the shared seeded `Test Client One`,
 * per this lane's own fixture discipline — not because this spec writes to
 * it, but so it never depends on `Test Client One`'s real, operator-edited
 * state staying shaped a particular way.
 *
 * What every assertion below measures: `scrollWidth > clientWidth` on the
 * SPECIFIC element that can actually clip — never a container whose own
 * overflow is untouched by a clipped descendant (fix round 1, reviewer C1
 * and I2: the original version measured the sidebar demo's bare,
 * unconstrained span and the stat-tile's ROOT, neither of which could ever
 * fail). `scrollWidth` is the element's full, unclipped content width;
 * `clientWidth` is what it was actually given. The pseudo-locale's accented
 * vowels plus the `Ẋẋ`/`Ṿṿ` padding words are ~35% longer than the real
 * English string, so an element whose CSS doesn't truncate or wrap would
 * clip under them and this comparison catches it directly (no screenshot,
 * no pixel diff).
 *
 * Two different "what passing means" per the sidebar's own design
 * (app-sidebar.tsx's `SidebarLink`): a REAL locale (English or Spanish)
 * must never clip at the sidebar's actual expanded width — that's
 * DESIGN.md's bilingual DoD line, and a clip there is a real defect. The
 * PSEUDO locale's synthetic +35% padding is allowed to clip, because the
 * real sidebar already tolerates truncation for an unusually long real
 * label via its own unconditional `title` tooltip (app-sidebar.tsx's
 * `title={item.label}`) — so the pseudo check instead asserts that any
 * label that DOES clip still carries that same full-text `title` fallback,
 * and reports which ones clipped.
 *
 * The actual pass/fail DECISION (given a scrollWidth/clientWidth/title
 * triple) lives in `./overflow-check.ts`, with its own unit tests
 * (`overflow-check.test.ts`) proving each decision can fail by name — a
 * browser isn't needed to prove the DECISION logic is right, only to prove
 * a real rendered element's measurements take the shape a given fix
 * claims. CI's `e2e` job is the authority for that second half; this file
 * was not run locally this round (see the fix-round report).
 */

test.describe("pseudo-locale overflow (F-014)", () => {
  test("dashboard KPI tiles: the label and period spans — the elements that can actually clip, not the tile root — never clip under the pseudo-locale", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json — the setup project creates it; run the full suite.");
      return;
    }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard?locale=pseudo`);
    // `[data-slot='stat-tile']` (the tile root) has no overflow of its own —
    // a clipped descendant never changes the root's OWN scrollWidth, so
    // measuring it can never fail regardless of what's inside (reviewer
    // I2). `stat-tile-label` (no `truncate`, wraps rather than clips on
    // ordinary multi-word text — a forward-looking regression guard, see
    // stat-tile.tsx's own comment) and `stat-tile-period` (`min-w-0
    // truncate` — the one element here that genuinely can clip) are the
    // two that matter.
    const measured = page.locator("[data-slot='stat-tile-label'], [data-slot='stat-tile-period']");
    const count = await measured.count();
    expect(count, "no stat-tile label/period spans found — confirm the fixture account and the data-slot values before trusting the loop below").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const el = measured.nth(i);
      const [scrollW, clientW, slot, text] = await el.evaluate((n) => [
        n.scrollWidth, n.clientWidth, n.getAttribute("data-slot"), n.textContent,
      ]);
      expect(clipFailure(scrollW, clientW, `${slot} "${text}"`)).toBeNull();
    }
  });

  test("sidebar nav labels: real English and Spanish never clip at the sidebar's expanded width", async ({ page }) => {
    await page.goto("/dashboard/styleguide");
    // Real locales only (`data-nav-label` is a boolean JSX attribute here,
    // which React renders as the literal string `"true"` — verified via
    // `renderToStaticMarkup` — distinct from the pseudo column's own
    // `data-nav-label="pseudo"` below).
    const labels = page.locator("[data-nav-label='true']");
    const count = await labels.count();
    expect(count, "no real-locale nav labels found — confirm the styleguide's Locale section shipped").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const el = labels.nth(i);
      const [scrollW, clientW, locale, text] = await el.evaluate((n) => [
        n.scrollWidth, n.clientWidth, n.getAttribute("data-locale"), n.textContent,
      ]);
      expect(clipFailure(scrollW, clientW, `${locale} nav label "${text}"`)).toBeNull();
    }
  });

  test("sidebar nav labels: any pseudo-locale label that clips at the sidebar's expanded width still carries its full text in title", async ({ page }, testInfo) => {
    await page.goto("/dashboard/styleguide?locale=pseudo");
    const labels = page.locator("[data-nav-label='pseudo']");
    const count = await labels.count();
    expect(count, "no pseudo-locale nav labels found — confirm the styleguide's third column shipped").toBeGreaterThan(0);
    const clipped: string[] = [];
    for (let i = 0; i < count; i++) {
      const el = labels.nth(i);
      const [scrollW, clientW, title, text] = await el.evaluate((n) => [
        n.scrollWidth, n.clientWidth, n.getAttribute("title"), n.textContent,
      ]);
      if (scrollW > clientW) clipped.push(text ?? "");
      expect(pseudoTitleFallbackFailure(scrollW, clientW, title, text)).toBeNull();
    }
    // Reported, not asserted on: clipping itself is accepted here (see this
    // file's own top comment) — this annotation is what a CI reader checks
    // to see which labels actually clipped under the pseudo-locale, same as
    // the brief's "report which labels clip under pseudo" asked for.
    testInfo.annotations.push({
      type: "pseudo-locale nav labels clipped",
      description: clipped.length > 0 ? clipped.join(", ") : "none",
    });
  });
});
