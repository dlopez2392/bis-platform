import { test as base } from "@playwright/test";
import { guardClerkDevBrowserCookie } from "./clerk-cookie-guard";

export * from "@playwright/test";

/**
 * The `test` every spec imports: Playwright's own, plus two automatic
 * fixtures that run guardClerkDevBrowserCookie in every page and frame of
 * every browser context, before any of the page's own scripts. With it,
 * clerk-js can never leave a navigation without its dev-browser cookie (see
 * clerk-cookie-guard.ts for the CI trace behind it).
 *
 *   - clerkDevBrowserCookieGuard: the context Playwright hands each test.
 *   - guardEveryNewContext: every context a spec builds itself with
 *     browser.newContext() — the client identity in billing.spec, the
 *     signed-in and agency contexts in client-branding.spec, and any future
 *     one — so a spec cannot opt out by forgetting.
 *
 * Specs import from here, never from "@playwright/test" directly;
 * clerk-cookie-guard.test.ts fails on any spec that does.
 */
export const test = base.extend<{ clerkDevBrowserCookieGuard: void }, { guardEveryNewContext: void }>({
  guardEveryNewContext: [
    async ({ browser }, use) => {
      const original = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await original(options);
        await context.addInitScript(guardClerkDevBrowserCookie);
        return context;
      };
      await use();
      browser.newContext = original;
    },
    { scope: "worker", auto: true },
  ],
  clerkDevBrowserCookieGuard: [
    async ({ context }, use) => {
      await context.addInitScript(guardClerkDevBrowserCookie);
      await use();
    },
    { auto: true },
  ],
});
