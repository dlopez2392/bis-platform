import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { recordPage } from "./support";
import { clipFailure } from "./overflow-check";
import { assertNoRedirect, waitForHeaderSettled, assertHeaderChildrenInBounds } from "./shell-geometry";
import { m, type MessageKey } from "../src/lib/messages";
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
 * SCOPE (updated, S-10 T9a): Billing, Branding and Team are now covered —
 * #324 (T6) merged into `main` after this file's first draft, converting
 * all three and shipping `.es` twins for `billing.page.title`,
 * `branding.clientTitle` and `team.title` (confirmed read through `t()`,
 * not a direct `m[...]` literal, by reading each page.tsx and
 * team-card.tsx). T9a (below, after review round 1's own gap note) routed
 * all three pages' copy through `requestPseudoMode` the way Dashboard/
 * Contacts/To do/Calls/Forms already were (billing/page.tsx,
 * branding/page.tsx and team/page.tsx, plus the client components each
 * renders, now take `pseudo` as a prop), so they carry their own content
 * assertions (`realSpanishOnlyRoutes`, real Spanish) AND a pseudo G9 proof
 * (the same array's own `pseudoProofKey`, read by a second loop over it,
 * below), the same two checks every other screen in this file gets.
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

test.describe("the Spanish dashboard, signed in end to end (S-10 T9)", () => {
  test.use({ storageState: SPANISH_AUTH_FILE });

  test("the shell: sidebar nav, the footer's Team link and the topbar search button read Spanish from the catalogue", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    // buildNavGroups(base, isAgency=false, isOwner=true): everything a
    // client Owner gets on this fixture account (nav-groups.ts) — 13
    // items. Scoped to the sidebar's own scrolling <nav> (app-sidebar.tsx),
    // never page-wide: the footer's Team link sits OUTSIDE this <nav> on
    // purpose (DESIGN.md rule 10 — the pinned footer cluster is a separate
    // region from the scrolling middle nav), so scoping here also keeps
    // this loop from ever matching it by accident.
    const navKeys = [
      "nav.dashboard", "nav.tasks", "nav.website", "nav.contacts", "nav.documents",
      "nav.opportunities", "nav.conversations", "nav.calls", "nav.activity", "nav.forms",
      "nav.calendar", "nav.branding", "nav.billing",
    ] as const;
    const nav = page.locator("aside nav");
    for (const key of navKeys) {
      await expect(nav.getByRole("link", { name: t(m, key, "es"), exact: true }), `sidebar link for ${key}`).toBeVisible();
    }
    // Pinned count, not just "these 13 are visible": a 14th link sneaking
    // in (or one of the 13 silently missing while something else fills
    // the gap) would pass the loop above but fail this.
    await expect(nav.getByRole("link")).toHaveCount(navKeys.length);
    // app-sidebar.tsx's footer: a client OWNER (not Staff) gets Team here,
    // outside <nav> (see the comment above) — scoped to <aside> instead.
    await expect(page.locator("aside").getByRole("link", { name: t(m, "nav.team", "es"), exact: true })).toBeVisible();
    // Negative control: an agency-only nav item must NEVER appear for this
    // client session — if it did, every "Spanish" assertion above would be
    // proving the wrong audience's sidebar.
    await expect(nav.getByRole("link", { name: t(m, "nav.checklist", "es"), exact: true })).toHaveCount(0);
    await expect(
      page.locator("header").getByRole("button", { name: t(m, "shell.search", "es"), exact: true }),
    ).toBeVisible();
  });

  test("Dashboard: the KPI row reads Spanish", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    await page.goto(`/dashboard/accounts/${fixture.accountId}/dashboard`);
    // Scoped to <main>: the route streams (loading.tsx), and a hidden,
    // parked second copy of the page can sit outside <main> until its
    // deferred reveal runs (support.ts's own RECORD_PAGE comment documents
    // the same streamed-duplicate shape for the record page).
    await expect(
      page.getByRole("main").getByText(t(m, "dashboard.kpi.last7Days", "es"), { exact: true }).first(),
    ).toBeVisible();
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
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { name: t(m, "forms.title", "es"), exact: true })).toBeVisible();
    await expect(main.getByText(t(m, "forms.empty.title", "es"))).toBeVisible();
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
 * CORRECTED (review round 1, I-1): the SHELL is NOT covered by the
 * document-level `assertNoPageScroll` measurement below. topbar.tsx's
 * `<header>` is `justify-end` (right-aligned), so an overflowing child
 * pushes content LEFT, past the header's own left edge — never past the
 * document's right edge, which is the only direction
 * `document.documentElement.scrollWidth` can see. The ONLY way to check
 * the topbar is `assertHeaderChildrenInBounds` (moved out of
 * phone-width.spec.ts into ./shell-geometry.ts, unchanged in behaviour, so
 * both files call the SAME logic) — see the dedicated shell test below,
 * which calls it directly. Separately: the shell has no PSEUDO variant of
 * its OWN text to check — it never reads `?locale=`, and at 375px the
 * sidebar's nav labels are CSS-`hidden` below the `sm` breakpoint anyway
 * (app-sidebar.tsx) — but the shell test still runs once under
 * `?locale=pseudo` because the PAGE behind the topbar changes width under
 * it, and a wider page can still shift chrome the topbar shares (e.g. a
 * scrollbar appearing); checking costs one extra navigation and removes a
 * blind spot rather than assuming the shell is inert to it.
 */
test.describe("G9 overflow — 375px, real Spanish and pseudo-Spanish (S-10 T9)", () => {
  test.use({ storageState: SPANISH_AUTH_FILE });
  const WIDTH = 375;
  const HEIGHT = 844; // matches phone-width.spec.ts's own constant


  /**
   * G9's document-level half: the whole page must not scroll sideways at
   * `width` (the same measurement phone-width.spec.ts's own
   * assertNoPageScroll takes for the English suite — this does NOT cover
   * the topbar, see this describe block's own comment above). On a
   * failure it also names the single widest element past the viewport's
   * right edge and not already contained by an ancestor that clips/
   * scrolls on its own — the same "don't blame an already-scrolling
   * wrapper's contents" reasoning phone-width.spec.ts's own
   * findWidestOffender uses, written fresh here (that file does not
   * export it) rather than left as a bare pass/fail, because this lane
   * found a real offender on its first run and a name beats a re-run to
   * find one. `opts.expectedPathname` is checked with the SAME
   * `assertNoRedirect` phone-width.spec.ts uses (review I-1/I-2) — a
   * redirect must fail this, not silently measure whatever page it landed
   * on. `opts.proveActive`, when given, runs right after the navigation
   * and before anything is measured, so a failure to activate pseudo mode
   * (or a locale that silently stayed English) reads as its OWN failure,
   * never as a false-negative "pass" on the overflow check below.
   */
  async function assertNoPageScroll(
    page: Page, navigateUrl: string, width: number,
    opts: { expectedPathname: string; proveActive?: (page: Page) => Promise<void> },
  ) {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto(navigateUrl);
    await assertNoRedirect(page, opts.expectedPathname);
    if (opts.proveActive) await opts.proveActive(page);
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
      clipFailure(measured.scrollWidth, measured.clientWidth, `${navigateUrl} at ${width}px: the document`),
      `widest offender: ${offender ?? "(none found — check for sibling overlap, not overflow)"}`,
    ).toBeNull();
  }

  /**
   * Proves `?locale=pseudo` actually changed the rendered string before
   * trusting a width measurement against it (review I-2, the same
   * discipline i18n-overflow.spec.ts's own positive controls use at
   * :154/:258 — there, against the plain ENGLISH string, because that
   * fixture's own resolved locale is English; here, against the plain
   * SPANISH string, because this user's resolved locale is "es"). `key`
   * must be a string this screen renders through `tr.text()`/`t()` WITH
   * the `pseudo` flag threaded in — picking one that is not pseudo-aware
   * would make this prove the wrong thing (see Calendar's own case below,
   * excluded from the page-title loop for exactly that reason).
   *
   * Scoped to <main>, never page-wide (found live, this review round):
   * the SIDEBAR's own nav link renders the SAME Spanish word as several of
   * these keys' plain value (`nav.forms.es`/`forms.title.es` are both
   * "Formularios"; same for Contacts/"Contactos", To do/"Pendientes",
   * Calls/"Llamadas") and the sidebar never reads `?locale=pseudo` (this
   * file's own top comment on the shell) — so an unscoped search found the
   * UNPADDED nav link and reported "pseudo is not active" on a page where
   * it demonstrably was (confirmed by a direct read of the rendered `<h1>`,
   * which was already correctly padded and bracketed).
   */
  function provePseudoActive(key: MessageKey) {
    return async (page: Page) => {
      await expect(
        page.getByRole("main").getByText(t(m, key, "es"), { exact: true }),
        `pseudo mode does not appear to be active for ${key}: its plain Spanish string is still present verbatim in <main>`,
      ).toHaveCount(0);
    };
  }

  const routes: Array<{ name: string; path: (base: string) => string; pseudoProofKey: MessageKey }> = [
    { name: "Dashboard", path: (base) => `${base}/dashboard`, pseudoProofKey: "dashboard.kpi.last7Days" },
    { name: "Contacts", path: (base) => `${base}/contacts`, pseudoProofKey: "contacts.title" },
    { name: "To do", path: (base) => `${base}/tasks`, pseudoProofKey: "work.title" },
    // S-10 T9a: Calendar's own title now routes through `tr.text()`
    // (calendar/page.tsx), so its proof is its own page title again, the
    // same shape every other route in this array uses.
    { name: "Calendar", path: (base) => `${base}/calendar`, pseudoProofKey: "calendar.title" },
    { name: "Calls", path: (base) => `${base}/calls`, pseudoProofKey: "calls.title" },
    { name: "Forms", path: (base) => `${base}/forms`, pseudoProofKey: "forms.title" },
  ];

  // ADD (review round 1, now that #324/T6 has merged): Billing, Branding
  // and Team. Each carries its own content assertions (not just "no
  // scroll") so this loop proves BOTH at once, in real Spanish. `pseudoProofKey`
  // (S-10 T9a) feeds the separate pseudo loop below (`pseudoWiredRoutes`),
  // now that all three pages route their copy through `requestPseudoMode`.
  const realSpanishOnlyRoutes: Array<{
    name: string; path: (base: string) => string; pseudoProofKey: MessageKey; assertContent: (page: Page) => Promise<void>;
  }> = [
    {
      name: "Billing", path: (base) => `${base}/billing`, pseudoProofKey: "billing.page.title",
      assertContent: async (page) => {
        // `{ level: 1 }`: the PageHeader's own h1, never a card's own h3 —
        // found live, this review round, on Team (below), where
        // "Equipo" also names a card heading and an unleveled role query
        // threw a strict-mode violation across both.
        await expect(page.getByRole("heading", { level: 1, name: t(m, "billing.page.title", "es"), exact: true })).toBeVisible();
        // This fixture has no billing row (no plan, no Stripe customer):
        // the page's own designed EMPTY state (DESIGN.md rule 5), not an
        // error — billing-view.ts's own "not set up yet" branch.
        await expect(page.getByText(t(m, "billing.page.empty.title", "es"))).toBeVisible();
      },
    },
    {
      name: "Branding", path: (base) => `${base}/branding`, pseudoProofKey: "branding.clientTitle",
      assertContent: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: t(m, "branding.clientTitle", "es"), exact: true })).toBeVisible();
        // alert-phone-card.tsx:239 — a second card on the SAME page, below
        // the branding panel, confirmed by reading that file.
        await expect(page.getByText(t(m, "settings.alertPhone", "es"), { exact: true })).toBeVisible();
      },
    },
    {
      name: "Team", path: (base) => `${base}/team`, pseudoProofKey: "team.title",
      assertContent: async (page) => {
        // `{ level: 1 }`: TeamSection's own card ALSO carries an "Equipo"
        // heading (an `<h3 data-slot="card-title">`) — an unleveled query
        // resolved to both and threw a strict-mode violation.
        await expect(page.getByRole("heading", { level: 1, name: t(m, "team.title", "es"), exact: true })).toBeVisible();
        await expect(page.getByText(t(m, "team.page.subtitle", "es"))).toBeVisible();
        // Checked first (review I-ADD): team-card.tsx renders a member's
        // role inside a <Select>'s SelectTrigger/SelectValue — a DotPill
        // carrying `rolePill(locale)[role].label`, confirmed by reading
        // team-card.tsx and team-copy.ts — so this is a COMBOBOX's current
        // value, not a plain text node, even though it reads as one here.
        // This fixture's account has exactly one team row (its own Owner;
        // no Staff/Technician were ever added to it), so `[data-team-row]`
        // is unambiguous without filtering by id.
        await expect(page.locator("[data-team-row]")).toContainText(t(m, "team.role.owner", "es"));
      },
    },
  ];

  /**
   * I-1: the topbar's own geometry — document-level scrollWidth cannot see
   * it (this describe block's own top comment explains why), so this
   * calls assertHeaderChildrenInBounds directly, the same way
   * phone-width.spec.ts does for the English suite. Real Spanish and
   * pseudo, on the same route, for the reason given above.
   */
  test("the shell: the topbar's own children stay within [header-left, viewport-right] at 375px", async ({ page }) => {
    const fixture = spanishFixture();
    if (!fixture) { test.skip(true, SKIP_REASON); return; }
    const route = `/dashboard/accounts/${fixture.accountId}/dashboard`;
    for (const url of [route, `${route}?locale=pseudo`]) {
      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
      await page.goto(url);
      await assertNoRedirect(page, route);
      await waitForHeaderSettled(page, false, true); // client session, in-account
      await assertHeaderChildrenInBounds(page, url, WIDTH);
    }
  });

  for (const { name, path } of routes) {
    test(`${name}: no horizontal page scroll at ${WIDTH}px, real Spanish`, async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      const route = path(`/dashboard/accounts/${fixture.accountId}`);
      await assertNoPageScroll(page, route, WIDTH, { expectedPathname: route });
    });
  }

  for (const { name, path, assertContent } of realSpanishOnlyRoutes) {
    test(`${name}: content reads Spanish and there is no horizontal page scroll at ${WIDTH}px, real Spanish`, async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      const route = path(`/dashboard/accounts/${fixture.accountId}`);
      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
      await page.goto(route);
      await assertNoRedirect(page, route);
      await assertContent(page);
      const measured = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(clipFailure(measured.scrollWidth, measured.clientWidth, `${route} at ${WIDTH}px: the document`)).toBeNull();
    });
  }

  for (const { name, path, pseudoProofKey } of routes) {
    // FIXED (S-10 T9a; was `test.fixme` — real finding on Calendar only,
    // confirmed by a solo run of this exact test before the fix and
    // measured in the browser, review round 1 I-4):
    //
    // At 375px, under the pseudo-locale's +35% padding, the OUTER grid at
    // calendar/page.tsx (`grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]`)
    // declared a column template ONLY at `lg:` — below it there was no
    // mobile template at all, so the grid fell back to ONE implicit,
    // `auto`-sized column holding both children (the CalendarSettings
    // Card's wrapper and the ClosedDaysCard's wrapper, each a sibling
    // `<div className="space-y-6">`). Measured directly, BEFORE the fix:
    // `getComputedStyle(grid).gridTemplateColumns` resolved to
    // `"318.062px"`, while the grid's OWN rendered width
    // (`grid.getBoundingClientRect().width`) was only 263px (its parent,
    // `div.space-y-6.p-6`, is 311px — the content area right of the 64px
    // collapsed sidebar rail — minus 24px of padding on each side). A CSS
    // Grid `auto` track takes the LARGEST min-content contribution of the
    // items placed in it rather than shrinking to the container, and
    // nothing in that chain (the grid item itself, the Card, CardHeader's
    // own `@container/card-header` grid) carried a `min-width: 0`
    // override to let it shrink below that — so the track floored at
    // 318px, 55px past its own 263px container, and the document ended up
    // 406px wide, 31px past the 375px viewport
    // (`scrollWidth 406 > clientWidth 375`).
    //
    // The exact LEAF driving that 318.062px figure was NOT pinned — stated,
    // not guessed, at the time: the card's own `<h3>` title (268px), its
    // `<p>` description (268px), every day-of-week row (268px) and all five
    // `<SelectTrigger>` elements' own min-content width (74 to 164px) all
    // measured BELOW the 318px figure on their own, so no single unwrapped
    // text run explained it alone.
    //
    // FIX: `grid-cols-1` on the outer grid (a real, explicit single-column
    // track instead of an ambiguous implicit `auto` one) plus `min-w-0` on
    // both `<div className="space-y-6">` wrappers (the actual grid items —
    // Card's own `min-w-0`, which every OTHER item on this page already
    // gets from `ui/card.tsx`, never reached these because they sit a level
    // above the Card). forms/[formId]/page.tsx carried the identical
    // `lg:grid-cols-[minmax(0,1fr)_…]` pattern and got the same fix.
    test(`${name}: no horizontal page scroll at ${WIDTH}px, pseudo-Spanish (+35%)`, async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      const route = path(`/dashboard/accounts/${fixture.accountId}`);
      await assertNoPageScroll(page, `${route}?locale=pseudo`, WIDTH, {
        expectedPathname: route, proveActive: provePseudoActive(pseudoProofKey),
      });
    });
  }

  // S-10 T9a: Billing, Branding and Team now route their copy through
  // `requestPseudoMode` too (`realSpanishOnlyRoutes`'s own `pseudoProofKey`,
  // added alongside this), so they get the SAME pseudo G9 proof every route
  // above does — a separate loop, not folded into `routes`, because these
  // three keep their own `assertContent` for the real-Spanish case above
  // and gain nothing by duplicating that content check here too.
  for (const { name, path, pseudoProofKey } of realSpanishOnlyRoutes) {
    test(`${name}: no horizontal page scroll at ${WIDTH}px, pseudo-Spanish (+35%)`, async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      const route = path(`/dashboard/accounts/${fixture.accountId}`);
      await assertNoPageScroll(page, `${route}?locale=pseudo`, WIDTH, {
        expectedPathname: route, proveActive: provePseudoActive(pseudoProofKey),
      });
    });
  }

  // The page header's own <h1> (PageHeader, components/page-header.tsx) has
  // no truncate/no-wrap class — a longer title WRAPS rather than clips by
  // CSS, so this is the same "prove it, don't eyeball it" measurement as
  // the document-level check above, aimed at the one element DESIGN.md's
  // "page titles" type role actually names.
  //
  // Filtered OUT before the loop (review I-3), not an early `return`
  // inside it, which registered a test that asserted nothing: Dashboard's
  // <h1> is the dynamic greeting (not a catalogue string, so there is
  // nothing to compare against) — the only screen left out now. Calendar's
  // own <h1> was read through plain `t()` (review I-2) until S-10 T9a wired
  // it through `tr.text()`, so it rejoins this loop like every other
  // screen; Billing, Branding and Team (S-10 T9a) join it for the first
  // time, now that their own `PageHeader` titles are pseudo-aware too.
  const pageTitleRoutes = [
    ...routes.filter((r) => r.name !== "Dashboard"),
    ...realSpanishOnlyRoutes,
  ];
  for (const { name, path } of pageTitleRoutes) {
    test(`${name}: the page title element itself does not clip at ${WIDTH}px, pseudo-Spanish`, async ({ page }) => {
      const fixture = spanishFixture();
      if (!fixture) { test.skip(true, SKIP_REASON); return; }
      const route = path(`/dashboard/accounts/${fixture.accountId}`);
      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
      await page.goto(`${route}?locale=pseudo`);
      await assertNoRedirect(page, route);
      const heading = page.getByRole("heading", { level: 1 }).first();
      await expect(heading, `${name}'s page title`).toBeVisible();
      const [scrollW, clientW, text] = await heading.evaluate((n) => [n.scrollWidth, n.clientWidth, n.textContent]);
      expect(clipFailure(scrollW as number, clientW as number, `${name} <h1> "${text}"`)).toBeNull();
    });
  }
});
