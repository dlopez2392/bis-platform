import { existsSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "./fixtures/test";
import { buildNavGroups } from "../src/lib/nav-groups";
import { readClientFixture } from "./support";
import { serviceDb, setClientAccess, listContacts, listForms, upsertVoiceProfile, getVoiceProfile } from "@bis/db";

/**
 * F-107 (rider part): "at phone width the sidebar opens collapsed, its
 * footer pinned, and content reflows to fit" (docs/crm-features.md §4.3,
 * the row `| 5 | F-107 (part) |`). This is the "measure, don't guess"
 * evidence the brief asked for: a sweep of every signed-in dashboard route
 * at phone width, asserting none of them scrolls the PAGE sideways. A wide
 * table, chart or code block may still scroll inside its OWN container —
 * DESIGN.md's own rule, and shadcn's <Table> (ui/table.tsx) already wraps
 * itself in `overflow-x-auto`, so this file does not re-check that; it only
 * checks the outer page.
 *
 * Runs on the "phone" Playwright project (playwright.config.ts): Chromium,
 * with `devices["iPhone 13"]`'s VIEWPORT only — never the rest of that
 * descriptor, which belongs to a real device running Safari. Each check
 * below also sets its own viewport explicitly (320 and 375, the two widths
 * DESIGN.md's rider names) rather than relying solely on the project
 * default, so the width under test is visible at the call site.
 *
 * Why the per-run CLIENT fixture, never Test Client One (the brief's own
 * instruction for this spec): Test Client One is shared with every
 * concurrent run and every other spec in this suite, so its seeded content
 * — contact count, call rows, table width — can change mid-run. A
 * content-WIDTH assertion is exactly the kind of check a shared, mutating
 * row would make flaky. The fixture account is this run's alone and this
 * file only reads it. Its in-account route list is built from
 * `buildNavGroups` (nav-groups.ts) — the same pure, tested module the real
 * sidebar renders from — rather than a second, hand-kept list that could
 * drift from the real nav.
 *
 * Two identities view the SAME fixture account: the fixture's own client
 * session (CLIENT_AUTH_FILE) for the routes a client sees, and the agency
 * session every other project in this config already defaults to
 * (AUTH_FILE — this project's own `use.storageState`, read implicitly by
 * not overriding it) for the agency-only routes a client never sees (Setup,
 * Voice, Automations, Checklist, Settings). `requireAccountAccess`
 * (lib/auth.ts) lets an agency_admin into ANY account by id, so reaching
 * the fixture account from the agency session never touches Test Client
 * One either.
 *
 * Layout width does not depend on theme — color tokens do (DESIGN.md's own
 * contrast sweep, `branding/theme.test.ts`, covers those) — so one theme is
 * enough here.
 *
 * F-107 r1 review, item 2: `client-access.spec.ts` deliberately switches
 * this SAME fixture account's `client_access_enabled` to false and leaves
 * it there (its own comment: "Deliberately not restored to true here...
 * auth.teardown.ts restores the flag... whether or not this assertion (or
 * any above it) fails") — so the client-session describe below passed only
 * because this file happened to run before that one. `automations-b.spec.ts`
 * (:35-48), `automations.spec.ts` (:40-51) and `activity.spec.ts` (:23-27)
 * all carry the identical file-level `beforeAll` for the identical reason;
 * this is the fourth.
 */

const CLIENT_AUTH_FILE = "e2e/.auth/client-state.json";
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

type ClientFixture = { accountId: string; clerkUserId: string };
/** Read at RUN TIME, matching automations-b.spec.ts's own `fixture()` —
 *  `readClientFixture` (support.ts) is read by many specs and deliberately
 *  narrows to `{ accountId, companyName }`; `clerkUserId` is needed here
 *  only for `setClientAccess`'s actor id, so this file reads the same JSON
 *  itself rather than widening that shared helper for one caller. */
function clientFixture(): ClientFixture | null {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return null;
  const parsed = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as Partial<ClientFixture>;
  if (!parsed.accountId || !parsed.clerkUserId) return null;
  return { accountId: parsed.accountId, clerkUserId: parsed.clerkUserId };
}

/**
 * The fixture account's voice profile EXACTLY as this file found it,
 * restored in `afterAll` — the same `priorProfileCaptured` shape
 * concierge.spec.ts and forward-calls.spec.ts both use, for the identical
 * reason (F-107 r3 review, item 2): this "phone" project depends only on
 * "setup", never on "chromium", so nothing orders it against
 * forward-calls.spec.ts, setup.spec.ts or concierge.spec.ts (which all run
 * on "chromium" and rely on this SAME fixture account having no, or a
 * specific, voice profile). `priorProfileCaptured` is TRUE the moment the
 * read below succeeds, whether or not a row existed — `priorProfile`
 * staying null IS a captured state ("there was none before").
 */
let priorProfile: Awaited<ReturnType<typeof getVoiceProfile>> = null;
let priorProfileCaptured = false;
let fixtureRef: ClientFixture | null = null;

test.beforeAll(async () => {
  const fx = clientFixture();
  if (!fx) return;
  fixtureRef = fx;
  const db = serviceDb();
  await setClientAccess(db, fx.accountId, true, fx.clerkUserId);
  // F-107 r2 review, item 4: turns the topbar presence pill (DESIGN.md "AI
  // presence") on for this run's own fixture account, so the agency-only
  // describe below can check it live instead of stating it is out of
  // scope. Every other `voice_profiles` column defaults (0019_voice_
  // core.sql); the table is in `ACCOUNT_OWNED_TABLES`
  // (packages/db/src/account-teardown.ts), so auth.teardown.ts's cascade
  // removes it with the rest of the account — belt-and-braces with the
  // afterAll restore below, which runs first in the ordinary (non-killed)
  // case.
  priorProfile = await getVoiceProfile(db, fx.accountId);
  priorProfileCaptured = true;
  await upsertVoiceProfile(db, fx.accountId, { enabled: true }, fx.clerkUserId);
});

test.afterAll(async () => {
  if (!fixtureRef || !priorProfileCaptured) return;
  const db = serviceDb();
  if (priorProfile) {
    // Every column named rather than spread (concierge.spec.ts's own
    // precedent), so a column added to VoiceProfileRow later shows up here
    // as a typecheck-visible omission instead of silently not being
    // restored. `forward_calls` is excluded on purpose — upsertVoiceProfile
    // refuses it; it is written only by setForwardCalls, which this file
    // never calls.
    const p = priorProfile;
    await upsertVoiceProfile(db, fixtureRef.accountId, {
      persona_name: p.persona_name, greeting_en: p.greeting_en, greeting_es: p.greeting_es,
      facts: p.facts, services: p.services, languages: p.languages,
      booking_enabled: p.booking_enabled, after_hours: p.after_hours, enabled: p.enabled,
      textback_enabled: p.textback_enabled, textback_body: p.textback_body,
      public_id: p.public_id, concierge_enabled: p.concierge_enabled,
      concierge_form_id: p.concierge_form_id,
    }, fixtureRef.clerkUserId);
  } else {
    // There was no profile before this file ran, so the only faithful
    // restore is for there to be none after. F-107 r4 review, item 3:
    // the delete's own error was ignored — destructured and thrown
    // instead, forward-calls.spec.ts's own precedent (:157-163), so a
    // failed restore surfaces as a failed `afterAll` rather than a
    // silently stranded row.
    const { error } = await db.from("voice_profiles").delete().eq("account_id", fixtureRef.accountId);
    if (error) throw new Error(`phone-width spec: voice_profiles restore-delete failed: ${error.message}`);
  }
});

const WIDTH = 375;
const NARROW_WIDTH = 320;
const HEIGHT = 844;

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
async function assertHeaderChildrenInBounds(page: Page, route: string, width: number) {
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

/**
 * F-107 r2 review, item 1: CI found a real overflow this rider's own local
 * fixture never reproduced (bis-ci's /dashboard/accounts lists every
 * account every earlier spec in that run created, with real long names and
 * zones this run's one-account fixture never has) — and the failure
 * carried no trace artifact, just a width number. Kept permanently, not
 * removed after this round: cheap (one extra `evaluate`, only when the
 * page is ALREADY failing) and names the exact element in the assertion
 * message itself, so the NEXT CI-only overflow does not need a diagnostic
 * bolted on after the fact to find out what it was.
 *
 * "Contained" mirrors assertHeaderChildrenInBounds's own reasoning:
 * an element inside an ancestor that already clips/scrolls (and is itself
 * within bounds) is not the page's own overflow cause — ui/table.tsx's
 * `overflow-x-auto` wrapper is exactly this, and flagging ITS contents
 * would blame the wrong element for a wide table that is already scrolling
 * correctly inside itself.
 */
async function findWidestOffender(page: Page, clientWidth: number): Promise<string | null> {
  return page.evaluate((vw: number) => {
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
    // F-107 r3 review, item 3: `getAttribute("class")`, not `.className` —
    // on an SVG element `.className` is an SVGAnimatedString, not a
    // string; `.toString()` would print "[object SVGAnimatedString]"
    // instead of the actual class list (exactly what an earlier CI
    // offender's own text showed this diagnostic doing).
    const cls = el.getAttribute("class");
    const selector = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}` +
      (cls ? `.${cls.trim().split(/\s+/)[0]}` : "");
    return `${selector} right=${Math.round(widest.r.right)} width=${Math.round(widest.r.width)} ` +
      `text="${(el.textContent || "").slice(0, 40)}"`;
  }, clientWidth);
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
async function waitForHeaderSettled(page: Page, isAgency: boolean, inAccount: boolean) {
  await page.locator(".cl-userButton-root").first().waitFor({ state: "visible" });
  if (isAgency) {
    await page.locator(".cl-organizationSwitcher-root").first().waitFor({ state: "visible" });
  }
  if (inAccount) {
    // A single `data-testid`, not a text match: both of TopbarPresence's
    // CSS-toggled variants contain overlapping text ("this week" in both
    // the short and full idle phrase), so a text locator's `.first()` did
    // not reliably resolve to whichever one the viewport actually shows.
    await page.getByTestId("topbar-presence").waitFor({ state: "visible" });
  }
}

async function assertNoPageScroll(
  page: Page, route: string, width: number,
  opts: { isAgency: boolean; inAccount: boolean },
) {
  await test.step(`${route} at ${width}px`, async () => {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto(route);
    // F-107 r1 review, item 2: a redirect (e.g. access-off, not-found, or a
    // client bounced back to their own account) must fail this check, not
    // silently pass it by measuring whatever page it landed on instead.
    const pathname = new URL(page.url()).pathname;
    expect(pathname, `${route} redirected to ${pathname}`).toBe(route);
    await waitForHeaderSettled(page, opts.isAgency, opts.inAccount);
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (measured.scrollWidth > measured.clientWidth) {
      const offender = await findWidestOffender(page, measured.clientWidth);
      expect(
        measured.scrollWidth,
        `${route} at ${width}px: the page is ${measured.scrollWidth}px wide, ` +
          `${measured.scrollWidth - measured.clientWidth}px past its own ` +
          `${measured.clientWidth}px viewport. Widest offender: ${offender ?? "(none found — check for sibling overlap, not overflow)"}`,
      ).toBeLessThanOrEqual(measured.clientWidth);
    }
    await assertHeaderChildrenInBounds(page, route, width);
  });
}

/**
 * The flat, top-level agency group (base === null) plus the two real agency
 * routes nav-groups.ts never lists at all: the agency's own top-level
 * dashboard (requireAgency, src/app/(dashboard)/dashboard/page.tsx) and
 * /styleguide (DESIGN.md's DoD line — not nav-reachable, but a real route
 * this rider's own DoD item points at).
 */
function topLevelAgencyRoutes(): string[] {
  const fromNav = buildNavGroups(null, true).flatMap((g) => g.items.map((i) => i.href));
  return [...fromNav, "/dashboard", "/dashboard/styleguide"];
}

test.describe("top-level agency routes (agency session, no account) — phone width", () => {
  test("every top-level route has no horizontal page scroll", async ({ page }) => {
    for (const route of topLevelAgencyRoutes()) {
      await assertNoPageScroll(page, route, WIDTH, { isAgency: true, inAccount: false });
    }
  });
});

test.describe("in-account routes, client session — phone width", () => {
  test.use({ storageState: CLIENT_AUTH_FILE });

  test("every client-visible route in this account has no horizontal page scroll", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json — the setup project creates it; run the full suite.");
      return;
    }
    const base = `/dashboard/accounts/${fixture.accountId}`;
    const routes = buildNavGroups(base, false).flatMap((g) => g.items.map((i) => i.href));
    for (const route of routes) {
      await assertNoPageScroll(page, route, WIDTH, { isAgency: false, inAccount: true });
    }

    // F-107 r1 review, item 5: detail routes, read-only, on the fixture
    // (never Test Client One). The fixture seeds exactly one contact
    // (auth.setup.ts) — its internal id is never written to the fixture
    // file (only the name is), so it is looked up here, read-only, the same
    // way automations-b.spec.ts reads the same account directly.
    const db = serviceDb();
    const contacts = await listContacts(db, fixture.accountId, { limit: 1 });
    // F-107 r2 review, item 4: auth.setup.ts always seeds exactly one
    // contact — a silent `if (length > 0)` would quietly skip this route
    // forever if that fixture ever stopped seeding one, rather than
    // failing loudly the way a real regression should.
    expect(contacts.length, "the fixture always seeds one contact (auth.setup.ts)").toBeGreaterThan(0);
    await assertNoPageScroll(page, `${base}/contacts/${contacts[0]!.id}`, WIDTH, { isAgency: false, inAccount: true });
    // contacts/import needs no fixture data — it is the CSV wizard's own
    // first step (DESIGN.md's "CSV import" pattern: "choose a file").
    await assertNoPageScroll(page, `${base}/contacts/import`, WIDTH, { isAgency: false, inAccount: true });

    // F-107 r1 review, item 1: below `sm`, the sidebar's label spans are
    // CSS-`hidden` even when the cookie-free default (`collapsed=false`)
    // applies — the regression this round found was an EMPTY accessible
    // name on every nav link but Conversations. `getByRole` resolves by
    // accessible name, so this fails exactly the way a screen reader user
    // would experience it failing. `exact: true` (F-107 r2 review, item 5):
    // without it this would also match "Contacts" as a SUBSTRING of a
    // longer accessible name, which is not what this is proving.
    await expect(page.getByRole("link", { name: "Contacts", exact: true })).toBeVisible();
  });
});

test.describe("in-account agency-only routes, agency session on the SAME fixture account — phone width", () => {
  test("every agency-only route in this account has no horizontal page scroll", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json — the setup project creates it; run the full suite.");
      return;
    }
    const base = `/dashboard/accounts/${fixture.accountId}`;
    // nav-groups.ts never lists Settings or Setup: Settings is the sidebar
    // FOOTER link (app-sidebar.tsx), and Setup leaves the nav once it
    // starts (nav-groups.ts's own doc comment) — both are still real,
    // agency-only routes this rider's shell touches.
    const routes = [
      ...buildNavGroups(base, true).flatMap((g) => g.items.map((i) => i.href)),
      `${base}/settings`,
      `${base}/setup`,
    ];
    for (const route of routes) {
      await assertNoPageScroll(page, route, WIDTH, { isAgency: true, inAccount: true });
    }

    // F-107 r1 review, item 5: forms/[formId], read-only, if the fixture has
    // one — auth.setup.ts publishes exactly one ("E2E Brand Form …"), so it
    // does. No call row exists anywhere in this fixture (auth.setup.ts never
    // creates one), so calls/[callId] is not exercised here — stated, not
    // silently skipped.
    const db = serviceDb();
    const forms = await listForms(db, fixture.accountId);
    // F-107 r2 review, item 4: auth.setup.ts always publishes exactly one
    // form ("E2E Brand Form …") — same reasoning as the contact above.
    expect(forms.length, "the fixture always publishes one form (auth.setup.ts)").toBeGreaterThan(0);
    await assertNoPageScroll(page, `${base}/forms/${forms[0]!.id}`, WIDTH, { isAgency: true, inAccount: true });

    // F-107 r1 review, item 1: the Settings footer link is the same
    // SidebarLink component as every nav item — same fix, same proof.
    // `exact: true` (F-107 r2 review, item 5): see the client session's
    // identical note on the Contacts check above.
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();

    // F-107 r2 review, item 4: the topbar presence pill (DESIGN.md "AI
    // presence") does render here — `upsertVoiceProfile(..., { enabled:
    // true })` in this file's own beforeAll turns it on for the fixture
    // account. Checked here rather than "stated as out of scope": every
    // other column on `voice_profiles` defaults (0019_voice_core.sql), the
    // table is in `ACCOUNT_OWNED_TABLES` (packages/db/src/
    // account-teardown.ts), so auth.teardown.ts's cascade removes it with
    // the rest of the account — a real write, but a safe and cheap one,
    // not a read. F-107 r4 review (item 1) collapsed this page's own
    // presence text to "0 this week" below `sm` (this test runs at
    // `WIDTH` = 375px — DESIGN.md's rider's primary width, below `sm`) —
    // the full "✓ 0 calls handled this week" phrase this assertion used
    // to check for is now `hidden` there on purpose, so the check is
    // against the SAME `data-testid` wrapper `waitForHeaderSettled` (this
    // file) already proved visible above, not against either phrase's
    // own text.
    await expect(page.getByTestId("topbar-presence")).toBeVisible();
  });

  // The Goal's stricter, parenthetical width — checked on a representative
  // subset (the shell itself, a data table, and the agency's multi-card
  // Settings page, DESIGN.md rule 8's own example) rather than every route
  // a second time, to keep this project's cost to roughly 1.3x instead of 2x.
  //
  // F-107 r1 review, item 4: /dashboard/accounts is back in this subset.
  // Every agency e2e session mints a Clerk org with no `accounts` row
  // behind it, which `lib/accounts/orphans.ts`'s orphanedOrgs() always
  // counts as an orphan, so this route's "half-created company" banner
  // renders on every run of this suite, never only on a lucky draw — and
  // its icon now stacks above the text below `sm` (accounts/page.tsx),
  // freeing the 48px the "Add as a company" button needed.
  test("a representative subset holds at the narrower 320px too", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json — the setup project creates it; run the full suite.");
      return;
    }
    const base = `/dashboard/accounts/${fixture.accountId}`;
    // F-107 r4 review, item 2: `inAccount` per-route, not one blanket
    // value for the whole loop — /dashboard/accounts is the top-level
    // agency list (no account, no presence pill); the rest are in this
    // SAME fixture account, which this spec's own beforeAll keeps an
    // enabled voice profile on, so their presence pill genuinely renders
    // and is worth waiting for.
    const routes: { path: string; inAccount: boolean }[] = [
      { path: "/dashboard/accounts", inAccount: false },
      { path: `${base}/dashboard`, inAccount: true },
      { path: `${base}/contacts`, inAccount: true },
      { path: `${base}/settings`, inAccount: true },
      { path: `${base}/voice`, inAccount: true },
    ];
    for (const { path, inAccount } of routes) {
      await assertNoPageScroll(page, path, NARROW_WIDTH, { isAgency: true, inAccount });
    }
  });
});
