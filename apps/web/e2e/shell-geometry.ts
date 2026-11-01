import { type Page, expect } from "@playwright/test";

/**
 * Shared shell-geometry helpers, moved out of phone-width.spec.ts (review
 * round I-1, S-10 T9) so spanish-dashboard.spec.ts's own G9 check can call
 * the SAME header-overflow logic instead of a weaker, document-scrollWidth-
 * only measurement that provably cannot see the bug it exists to catch (see
 * assertHeaderChildrenInBounds's own comment below). Every function here is
 * byte-identical in BEHAVIOUR to what phone-width.spec.ts carried directly;
 * only the location moved. A plain `@playwright/test` import, not
 * `./fixtures/test`, matches support.ts's own precedent: clerk-cookie-
 * guard.test.ts's import rule only scans `*.spec.ts` files, and a non-spec
 * helper module needs no guarded `test`/`context` of its own — only the
 * `Page` type and `expect`.
 */

/**
 * F-107 r1 review, item 2: a redirect (e.g. access-off, not-found, or a
 * client bounced back to their own account) must fail a geometry check, not
 * silently pass it by measuring whatever page it landed on instead.
 */
export async function assertNoRedirect(page: Page, route: string): Promise<void> {
  const pathname = new URL(page.url()).pathname;
  expect(pathname, `${route} redirected to ${pathname}`).toBe(route);
}

/**
 * F-107 r4 review, item 2: `goto` resolves on "load", not on every async
 * child mounting — Clerk's UserButton/OrganizationSwitcher and (in-account)
 * the presence pill all render after an SDK round trip, and measuring
 * right after `goto` let /dashboard and /contacts PASS at 320px with the
 * exact same header that failed on /settings moments later, for no reason
 * but timing: a route that measures before the header has its real
 * content proves nothing. `.cl-userButton-root`/`.cl-organizationSwitcher-
 * root` are Clerk's own structural class names (the org-switcher one is
 * confirmed from a real CI failure's own diagnostic text, not guessed —
 * Clerk's `cl-<component>-root` naming is consistent across its
 * components). The presence pill has no stable class of its own, so it is
 * found by the text either of its two states always contains.
 */
export async function waitForHeaderSettled(page: Page, isAgency: boolean, inAccount: boolean): Promise<void> {
  // F-107 r5 review (item 4): an explicit timeout on each wait, so a
  // failure NAMES the missing element (Playwright's default test timeout
  // would otherwise fail the whole `test.step` with no indication which of
  // these three waits — if any — never resolved).
  await page.locator(".cl-userButton-root").first().waitFor({ state: "visible", timeout: 10_000 });
  if (isAgency) {
    await page.locator(".cl-organizationSwitcher-root").first().waitFor({ state: "visible", timeout: 10_000 });
  }
  if (inAccount) {
    // A single `data-testid`, not a text match: both of TopbarPresence's
    // CSS-toggled variants contain overlapping text ("this week" in both
    // the short and full idle phrase), so a text locator's `.first()` did
    // not reliably resolve to whichever one the viewport actually shows.
    await page.getByTestId("topbar-presence").waitFor({ state: "visible", timeout: 10_000 });
  }
}

/**
 * F-107 r1 review, item 3: topbar.tsx's header is `justify-end` (right-
 * aligned), so overflow there pushes content LEFT, past the header's own
 * left edge — `document.documentElement.scrollWidth` cannot see that; it
 * only grows when something pushes the document's RIGHT edge out. Checked
 * on every route below (the topbar renders on all of them): every direct
 * child of `<header>` stays within the header's own left edge and the
 * viewport's right edge. Children with a zero-sized rect (e.g. a `hidden`
 * one) trivially pass and are not special-cased.
 */
export async function assertHeaderChildrenInBounds(page: Page, route: string, width: number): Promise<void> {
  const result = await page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return null;
    const hLeft = header.getBoundingClientRect().left;
    const vw = window.innerWidth;
    const bad = Array.from(header.children)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, r };
      })
      .filter(({ r }) => (r.width > 0 || r.height > 0) && (r.left < hLeft - 0.5 || r.right > vw + 0.5))
      .map(({ el, r }) => ({
        tag: el.tagName,
        // F-107 r3 review, item 3: `getAttribute("class")`, not
        // `.className` — on an SVG element `.className` is an
        // SVGAnimatedString, not a string, so `|| ""` never fires and
        // `.slice` would throw on the first SVG header child this ever
        // walks.
        cls: (el.getAttribute("class") || "").slice(0, 100),
        left: Math.round(r.left),
        right: Math.round(r.right),
      }));
    return { hLeft, vw, bad };
  });
  if (!result) return;
  expect(
    result.bad.length,
    `${route} at ${width}px: header child(ren) outside [${Math.round(result.hLeft)}, ${result.vw}]: ` +
      JSON.stringify(result.bad),
  ).toBe(0);
}
