import { existsSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "./fixtures/test";
import { buildNavGroups } from "../src/lib/nav-groups";
import { readClientFixture } from "./support";
import { serviceDb, setClientAccess, listContacts, listForms } from "@bis/db";

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

test.beforeAll(async () => {
  const fx = clientFixture();
  if (fx) await setClientAccess(serviceDb(), fx.accountId, true, fx.clerkUserId);
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
        cls: ((el as HTMLElement).className || "").slice(0, 100),
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

async function assertNoPageScroll(page: Page, route: string, width: number) {
  await test.step(`${route} at ${width}px`, async () => {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto(route);
    // F-107 r1 review, item 2: a redirect (e.g. access-off, not-found, or a
    // client bounced back to their own account) must fail this check, not
    // silently pass it by measuring whatever page it landed on instead.
    const pathname = new URL(page.url()).pathname;
    expect(pathname, `${route} redirected to ${pathname}`).toBe(route);
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      measured.scrollWidth,
      `${route} at ${width}px: the page is ${measured.scrollWidth}px wide, ` +
        `${measured.scrollWidth - measured.clientWidth}px past its own ` +
        `${measured.clientWidth}px viewport`,
    ).toBeLessThanOrEqual(measured.clientWidth);
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
      await assertNoPageScroll(page, route, WIDTH);
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
      await assertNoPageScroll(page, route, WIDTH);
    }

    // F-107 r1 review, item 5: detail routes, read-only, on the fixture
    // (never Test Client One). The fixture seeds exactly one contact
    // (auth.setup.ts) — its internal id is never written to the fixture
    // file (only the name is), so it is looked up here, read-only, the same
    // way automations-b.spec.ts reads the same account directly.
    const db = serviceDb();
    const contacts = await listContacts(db, fixture.accountId, { limit: 1 });
    if (contacts.length > 0) {
      await assertNoPageScroll(page, `${base}/contacts/${contacts[0]!.id}`, WIDTH);
    }
    // contacts/import needs no fixture data — it is the CSV wizard's own
    // first step (DESIGN.md's "CSV import" pattern: "choose a file").
    await assertNoPageScroll(page, `${base}/contacts/import`, WIDTH);

    // F-107 r1 review, item 1: below `sm`, the sidebar's label spans are
    // CSS-`hidden` even when the cookie-free default (`collapsed=false`)
    // applies — the regression this round found was an EMPTY accessible
    // name on every nav link but Conversations. `getByRole` resolves by
    // accessible name, so this fails exactly the way a screen reader user
    // would experience it failing.
    await expect(page.getByRole("link", { name: "Contacts" })).toBeVisible();
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
      await assertNoPageScroll(page, route, WIDTH);
    }

    // F-107 r1 review, item 5: forms/[formId], read-only, if the fixture has
    // one — auth.setup.ts publishes exactly one ("E2E Brand Form …"), so it
    // does. No call row exists anywhere in this fixture (auth.setup.ts never
    // creates one), so calls/[callId] is not exercised here — stated, not
    // silently skipped.
    const db = serviceDb();
    const forms = await listForms(db, fixture.accountId);
    if (forms.length > 0) {
      await assertNoPageScroll(page, `${base}/forms/${forms[0]!.id}`, WIDTH);
    }

    // F-107 r1 review, item 1: the Settings footer link is the same
    // SidebarLink component as every nav item — same fix, same proof.
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
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
    const routes = ["/dashboard/accounts", `${base}/dashboard`, `${base}/contacts`, `${base}/settings`, `${base}/voice`];
    for (const route of routes) {
      await assertNoPageScroll(page, route, NARROW_WIDTH);
    }
  });
});
