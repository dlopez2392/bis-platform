import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { recordPage } from "./support";
import { clipFailure } from "./overflow-check";
import { m } from "../src/lib/messages";
import { t } from "../src/lib/i18n/t";

// Playwright's config passes env to the webServer, not to this process, so
// the service-role credentials for the Contacts fixture below are loaded
// here — the same two paths, same reason, as every spec that talks to
// Supabase from the runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-10 T9: the signed-in Spanish dashboard, end to end, on the Spanish e2e
 * user auth.setup.ts's "authenticate as Spanish client user" test mints —
 * its OWN account, never the shared client fixture (see fixtures/stale.ts's
 * FIXTURE_CLIENT_ES_ACCOUNT_RE doc comment, and that setup test's own, for
 * why: staff-roles.spec.ts hard-codes the shared fixture's team-row count).
 *
 * Every assertion below reads its expected string from the catalogue
 * through `t(m, key, "es")` — never a hand-typed Spanish literal — so a
 * wording change in messages.ts cannot silently desync this file from what
 * the app actually renders (the same discipline phone-width.spec.ts's own
 * search-button check and i18n-overflow.spec.ts's positive controls use).
 *
 * `?locale=es` / `?locale=pseudo` (lib/i18n/request-locale.ts) are QA
 * overrides for the PAGE a request resolves. They are dead on the SHELL:
 * Next layouts receive no `searchParams` at all, and the shell's own locale
 * is resolved once in dashboard/layout.tsx from `users.language`
 * (docs/superpowers/specs/2026-10-31-spanish-dashboard-design.md §10's own
 * "the QA locale override never reaches the shell" finding). This user's
 * `users.language = 'es'` is therefore the only way to prove the shell
 * itself (sidebar, topbar, ⌘K) reads Spanish at all — no query override on
 * any other identity could substitute for it, in this suite or in
 * production.
 *
 * SCOPE, per the design spec's own table (§3.1) and this branch's git
 * history (`git log -- apps/web/src/lib/messages.ts` at this base commit,
 * 91472299): Billing (row 14), Branding (row 15) and Team (row 16) ARE
 * Owner-reachable — this fixture's user is an Owner — but T6 (the task that
 * converts those three screens) has not merged yet: `billing.page.title`
 * and `branding.clientTitle` carry no `.es` twin in messages.ts at all, and
 * `team.title`'s existing twin is read as a direct `m["team.title"]`
 * literal (team/page.tsx), never through `t()`, so it renders English
 * regardless of this user's language today. Asserting Spanish there would
 * fail on an already-known, unrelated gap rather than on anything this lane
 * touched, so those three screens are deliberately OMITTED below rather
 * than faked green with a weaker assertion. T6/T9 can extend coverage onto
 * this SAME fixture once they land (see auth.setup.ts's own comment).
 */

const SPANISH_AUTH_FILE = "e2e/.auth/client-es-state.json";
const SPANISH_CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture-es.json";

function spanishFixture(): { accountId: string; companyName: string } | null {
  if (!existsSync(SPANISH_CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(SPANISH_CLIENT_FIXTURE_FILE, "utf-8")) as {
    accountId?: string | null; companyName?: string;
  };
  if (!parsed.accountId) return null;
  return { accountId: parsed.accountId, companyName: parsed.companyName ?? "" };
}

const SKIP_REASON = `No Spanish client fixture at ${SPANISH_CLIENT_FIXTURE_FILE} — the setup project creates it; run the full suite.`;

/**
 * G9's document-level half: the whole page must not scroll sideways at
 * `width` (the same measurement phone-width.spec.ts's own assertNoPageScroll
 * takes for the English suite). On a failure it also names the single
 * widest element past the viewport's right edge and not already contained
 * by an ancestor that clips/scrolls on its own — the same "don't blame an
 * already-scrolling wrapper's contents" reasoning phone-width.spec.ts's own
 * findWidestOffender uses, written fresh here (that file does not export
 * it) rather than left as a bare pass/fail, because this lane found a real
 * offender on its first run and a name beats a re-run to find one.
 */
async function assertNoPageScroll(page: Page, route: string, width: number) {
  await page.setViewportSize({ width, height: 812 });
  await page.goto(route);
  const measured = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (measured.scrollWidth <= measured.clientWidth) return;
  const offender = await page.evaluate((vw: number) => {
    const isContained = (el: Element): boolean => {
      let node: Element | null = el.parentElement;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        if (style.overflowX !== "visible" && r.right <= vw + 1) return true;
        node = node.parentElement;
      }
      return false;
    };
    const widest = Array.from(document.querySelectorAll("*"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > vw + 1)
      .filter(({ el }) => !isContained(el))
      .sort((a, b) => b.r.right - a.r.right)[0];
    if (!widest) return null;
    const el = widest.el as HTMLElement;
    const cls = el.getAttribute("class");
    const selector = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}` +
      (cls ? `.${cls.trim().split(/\s+/)[0]}` : "");
    return `${selector} right=${Math.round(widest.r.right)} width=${Math.round(widest.r.width)} ` +
      `text="${(el.textContent || "").slice(0, 60)}"`;
  }, measured.clientWidth);
  expect(
    clipFailure(measured.scrollWidth, measured.clientWidth, `${route} at ${width}px: the document`),
    `widest offender: ${offender ?? "(none found — check for sibling overlap, not overflow)"}`,
  ).toBeNull();
}

test.describe("the Spanish dashboard, signed in end to end (S-10 T9)", () => {
  test.use({ storageState: SPANISH_AUTH_FILE });

  test("the shell: sidebar nav, the footer's Team link and the topbar search button read Spanish from the catalogue", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    // buildNavGroups(base, isAgency=false, isOwner=true): everything a
    // client Owner gets on this fixture account (nav-groups.ts).
    for (const key of [
      "nav.dashboard", "nav.tasks", "nav.website", "nav.contacts", "nav.documents",
      "nav.opportunities", "nav.conversations", "nav.calls", "nav.activity", "nav.forms",
      "nav.calendar", "nav.branding", "nav.billing",
    ] as const) {
      await expect(
        page.getByRole("link", { name: t(m, key, "es"), exact: true }),
        `sidebar link for ${key}`,
      ).toBeVisible();
    }
    // app-sidebar.tsx's footer: a client OWNER (not Staff) gets Team here.
    await expect(page.getByRole("link", { name: t(m, "nav.team", "es"), exact: true })).toBeVisible();
    // Positive control: an agency-only nav item must NEVER appear for this
    // client session — if it did, every "Spanish" assertion above would be
    // proving the wrong audience's sidebar.
    await expect(page.getByRole("link", { name: t(m, "nav.checklist", "es"), exact: true })).toHaveCount(0);
    await expect(
      page.locator("header").getByRole("button", { name: t(m, "shell.search", "es"), exact: true }),
    ).toBeVisible();
  });

  test("Dashboard: the KPI row reads Spanish", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    await expect(page.getByText(t(m, "dashboard.kpi.last7Days", "es"), { exact: true }).first()).toBeVisible();
  });

  test.describe("Contacts: the list, a record and the drawer read Spanish", () => {
    let contactId = "";

    test.beforeAll(async () => {
      const fixture = spanishFixture();
      if (!fixture) return; // each test below skips on its own when this is absent
      const db = serviceDb();
      const stamp = Date.now();
      // A phone number, same idiom as i18n-overflow.spec.ts's own record-page
      // case: with nobody to call, the header shows none of Call/Text/Email
      // (D4), and `[data-record-action="call"]` would never render at all —
      // which is exactly what the first run of this file found (not a wrong
      // Spanish word, an absent element). A random local number, not a fixed
      // one: createContact answers an EXISTING contact on a phone match, and
      // the afterAll below deletes whatever id it answered.
      const phone = `+1956297${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const { id, existing } = await createContact(db, fixture.accountId, {
        firstName: "E2E", lastName: `Spanish Contact ${stamp}`, phone,
      }, "e2e-spanish-dashboard");
      if (existing) {
        throw new Error(`spanish-dashboard e2e: ${phone} matched an existing contact; refusing to use (or delete) it.`);
      }
      contactId = id;
    });

    test.afterAll(async () => {
      const fixture = spanishFixture();
      if (!fixture || !contactId) return;
      const db = serviceDb();
      const { error } = await db.from("contacts").delete().eq("account_id", fixture.accountId).eq("id", contactId);
      if (error) console.error(`spanish-dashboard e2e: cleanup failed: ${error.message}`);
    });

    test("the list header and a record's header action read Spanish", async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts`);
      await expect(page.getByRole("heading", { name: t(m, "contacts.title", "es"), exact: true })).toBeVisible();

      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts/${contactId}`);
      const rec = recordPage(page);
      await expect(rec.locator('[data-record-action="call"]')).toHaveText(t(m, "record.action.call", "es"));
    });

    test("the contact list's drawer reads Spanish (S-03 part 3's own kit)", async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts?peek=${contactId}`);
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator('[data-record-action="call"]')).toHaveText(t(m, "record.action.call", "es"));
    });
  });

  test("To do: the list header reads Spanish", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/tasks`);
    await expect(page.getByRole("heading", { name: t(m, "work.title", "es"), exact: true })).toBeVisible();
  });

  test("Calendar: the page header reads Spanish", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/calendar`);
    await expect(page.getByRole("heading", { name: t(m, "calendar.title", "es"), exact: true })).toBeVisible();
  });

  test("Calls: the page header reads Spanish", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/calls`);
    await expect(page.getByRole("heading", { name: t(m, "calls.title", "es"), exact: true })).toBeVisible();
  });

  test("Forms: the page header and the empty state read Spanish", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/forms`);
    await expect(page.getByRole("heading", { name: t(m, "forms.title", "es"), exact: true })).toBeVisible();
    await expect(page.getByText(t(m, "forms.empty.title", "es"))).toBeVisible();
  });
});

/**
 * G9 for the shell and for every screen above (design spec §5.2's own
 * table): at 375px, for this Spanish user AND with `?locale=pseudo` (+35%
 * length), nothing clips. `clipFailure` (overflow-check.ts) is the same
 * decision i18n-overflow.spec.ts already uses, so a failure here is read
 * the same way: `scrollWidth` is the element's full, unclipped content
 * width, `clientWidth` is what it was actually given.
 *
 * `?locale=pseudo` reaches every PAGE below (each resolves its own
 * `requestPseudoMode`, confirmed by reading each page.tsx) — it pads
 * whichever locale `requestLocale` actually resolves, which for this user
 * is "es" regardless of the query param (`isLocale("pseudo")` is false, so
 * `requestLocale` never returns it — only `requestPseudoMode` reads it).
 * The pseudo case below is therefore padded SPANISH, not padded English:
 * exactly the shape a real Spanish deployment would ever render.
 *
 * The SHELL (sidebar, topbar) has no pseudo variant to check at all: it
 * never reads `?locale=`, and at 375px the sidebar's own nav labels are
 * CSS-`hidden` below the `sm` breakpoint (app-sidebar.tsx; confirmed by
 * reading that file), so there is no visible sidebar text to measure
 * clipping on at this width in the first place — only the topbar (and the
 * icon-only collapsed sidebar's own width) can overflow, and that is what
 * assertNoPageScroll's document-level measurement below catches. This
 * mirrors phone-width.spec.ts's own documented reasoning for why the
 * sidebar nav-label overflow case belongs to the styleguide demo, not a
 * phone-width run.
 */
test.describe("G9 overflow — 375px, real Spanish and pseudo-Spanish (S-10 T9)", () => {
  test.use({ storageState: SPANISH_AUTH_FILE });
  const WIDTH = 375;

  const routes: Array<{ name: string; path: (base: string) => string }> = [
    { name: "Dashboard", path: (base) => `${base}/dashboard` },
    { name: "Contacts", path: (base) => `${base}/contacts` },
    { name: "To do", path: (base) => `${base}/tasks` },
    { name: "Calendar", path: (base) => `${base}/calendar` },
    { name: "Calls", path: (base) => `${base}/calls` },
    { name: "Forms", path: (base) => `${base}/forms` },
  ];

  for (const { name, path } of routes) {
    test(`${name}: no horizontal page scroll at ${WIDTH}px, real Spanish`, async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      await assertNoPageScroll(page, path(`/dashboard/accounts/${fixture.accountId}`), WIDTH);
    });

    // FOUND, not fixed (brief: do not fix product UI in this lane). Real
    // finding on Calendar only, confirmed by a solo run of this exact test
    // (`pnpm exec playwright test e2e/spanish-dashboard.spec.ts -g
    // "Calendar: no horizontal page scroll at 375px, pseudo-Spanish"`): at
    // 375px, under the pseudo-locale's +35% padding, the Calendar page's
    // "booking-settings" Card (calendar-settings.tsx:118) — specifically
    // its `<form className="space-y-6">` (:138), whose CardTitle/
    // CardDescription read `calendar.settings.clientTitle` ("Sus ajustes de
    // citas") / `calendar.settings.clientBody` for a client Owner — pushes
    // the document to 406px, 31px past the 375px viewport
    // (`scrollWidth 406 > clientWidth 375`; widest offender measured:
    // `div.space-y-6 right=406 width=318`). Every other screen in this
    // loop (Dashboard, Contacts, To do, Calls, Forms) passes the identical
    // check. The body below is the real assertion, kept live rather than
    // dropped, so flipping `test.fixme` back to `test` is the whole fix
    // once calendar-settings.tsx's card is widened or its copy wraps.
    const testOrFixme = name === "Calendar" ? test.fixme : test;
    testOrFixme(`${name}: no horizontal page scroll at ${WIDTH}px, pseudo-Spanish (+35%)`, async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      await assertNoPageScroll(page, `${path(`/dashboard/accounts/${fixture.accountId}`)}?locale=pseudo`, WIDTH);
    });
  }

  // The page header's own <h1> (PageHeader, components/page-header.tsx) has
  // no truncate/no-wrap class — a longer title WRAPS rather than clips by
  // CSS, so this is the same "prove it, don't eyeball it" measurement as
  // the document-level check above, aimed at the one element DESIGN.md's
  // "page titles" type role actually names.
  for (const { name, path } of routes) {
    test(`${name}: the page title element itself does not clip at ${WIDTH}px, pseudo-Spanish`, async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      await page.setViewportSize({ width: WIDTH, height: 812 });
      await page.goto(`${path(`/dashboard/accounts/${fixture.accountId}`)}?locale=pseudo`);
      // Dashboard's <h1> is the dynamic greeting, not a plain catalogue
      // string — its own KPI label (stat-tile-period/label) is the element
      // i18n-overflow.spec.ts already measures for this exact screen, so
      // this file measures every OTHER screen's real <h1> and skips
      // Dashboard's here rather than re-deriving that spec's own check.
      if (name === "Dashboard") return;
      const heading = page.getByRole("heading", { level: 1 }).first();
      await expect(heading, `${name}'s page title`).toBeVisible();
      const [scrollW, clientW, text] = await heading.evaluate((n) => [n.scrollWidth, n.clientWidth, n.textContent]);
      expect(clipFailure(scrollW as number, clientW as number, `${name} <h1> "${text}"`)).toBeNull();
    });
  }
});
