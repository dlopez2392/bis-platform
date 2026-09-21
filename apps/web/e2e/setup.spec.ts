import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, setClientAccess, getOrCreateCalendar, updateCalendarSettings,
  listChecklistState,
} from "@bis/db";
import { SETUP_TICK_KEYS } from "../src/lib/setup/setup-status";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * Every unit test behind the setup wizard runs against `deriveSetupStatus`'s
 * plain inputs or a serviceDb-shaped fixture, and both are BLIND to column
 * grants and RLS — this project has shipped two defects behind exactly that
 * kind of green suite (migrations 0018 and 0020 are the corrections). The
 * setup page reads its six sources through `dbForRequest()`, i.e. as the
 * signed-in agency user, precisely so a grants problem shows up as a broken
 * step. This is the only layer that can see that happen.
 *
 * Design Phase 5 turned the page from nine stacked cards into a two-pane
 * wizard — a stepper rail plus ONE step's detail pane — so this file now also
 * carries the only proof of the architectural claim that change was made for:
 * that selecting a step is a CLIENT decision over nine already-rendered
 * nodes, with no server round trip. `vitest.config.ts` does not include
 * `.tsx`, and `lib/setup/setup-rail.ts` (the pure half) is tested there
 * already; the rail's DOM, the `?step=` history wiring, the keyboard
 * behaviour and the locked-step panes exist nowhere a unit test can reach.
 *
 * It runs against the CLIENT FIXTURE account (auth.setup.ts) rather than
 * `Test Client One`, for three reasons that all matter:
 *
 *  ① It is created fresh per run, so "this account has no calls / no number /
 *    no voice profile" is TRUE rather than assumed — which is what makes the
 *    go-live blocked list and the LOCKED rail states assertable in full.
 *  ② `Test Client One` carries four real voice calls made from a phone, so its
 *    test-call step is permanently green and its go-live gate could never be
 *    exercised here at all.
 *  ③ The client half of this file needs an account the CLIENT user actually
 *    owns; a client sent at any other account is redirected by
 *    `requireAccountAccess` long before `requireAgencyOnlyAccountAccess` — the
 *    redirect under test — is ever reached.
 *
 * WHAT THIS FILE MUTATES, AND HOW IT PUTS IT BACK. Three things: a
 * `calendars` row and its open hours (the hours regression cycle), one
 * `checklist_items` row (the email skip), and `accounts.name` (the rename).
 * The first two are deleted in `afterAll` — neither table is covered by
 * `deleteAccountCascade`'s original list for the reason `checklist_items` was
 * added to `fixtures/sweep.ts`, and a leaked row there makes the FINAL
 * account delete fail and strands a real Clerk user and org. `accounts.name`
 * is restored in `afterAll` too, and — belt and braces for the case where
 * `afterAll` never runs at all — this file only ever renames the account to
 * ANOTHER name matching `FIXTURE_ACCOUNT_RE` (`E2E Client Co <13-digit
 * stamp>`, fixtures/stale.ts). That regex is what the sweep matches on: a
 * rename to any other string would make a killed run's account invisible to
 * the one mechanism that cleans up after killed runs, permanently.
 */
test.describe.configure({ timeout: 120_000 });

type ClientFixture = { accountId: string; clerkUserId: string; companyName: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/**
 * Read at RUN TIME (called from inside `beforeAll`/test bodies below), never
 * at module scope: Playwright evaluates module scope during COLLECTION,
 * before the "setup" project has written this file, so a module-scope read
 * skipped every test in this file on every fresh CI checkout (measured: 21
 * skipped, `git log` 197b1b9/7413ff1/0740e6c). Missing at run time is a
 * FAILURE, not a skip — it means the "setup" project's dependency was
 * bypassed (a filtered invocation, or a bare `playwright test <file>`).
 */
const fixture = (): ClientFixture => {
  if (!existsSync(CLIENT_FIXTURE_FILE)) {
    throw new Error(
      `client fixture missing at ${CLIENT_FIXTURE_FILE} — the "setup" project did not run ` +
      `(a filtered invocation, or a bare "playwright test <file>", skips its dependency). ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as ClientFixture;
};

/**
 * The ten steps, in the order the rail walks them — keys AND titles, both
 * spelled out here rather than imported from `lib/setup/setup-rail.ts` and
 * `lib/messages.ts`. That duplication is the point: importing the order from
 * the implementation would make the "canonical order" assertion below agree
 * with itself no matter what the implementation said.
 */
const STEPS = [
  { key: "account", title: "Create the account" },
  { key: "branding", title: "Branding" },
  { key: "hours", title: "Business hours" },
  { key: "voice_profile", title: "Voice profile" },
  { key: "website_assistant", title: "Website assistant" },
  { key: "number", title: "Phone number" },
  { key: "email", title: "Email identity" },
  { key: "forwarding", title: "Call forwarding" },
  { key: "test_call", title: "Test call" },
  { key: "go_live", title: "Go live" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const stepIndex = (key: StepKey) => STEPS.findIndex((s) => s.key === key);
const stepTitle = (key: StepKey) => STEPS[stepIndex(key)]!.title;

/**
 * Every state word a rail entry can wear (lib/messages.ts, `setup.state.*`),
 * listed IN FULL so `expectRailState` can assert the others are absent — an
 * entry that says "Done" while also saying "Locked" is a bug this would
 * otherwise pass.
 *
 * "Current" and "Locked" are load-bearing members of this list, not padding.
 * `setup.state.next` ("Current") is what the one selected-as-next step wears
 * instead of "To do", and `setup.state.locked` is the sixth state the RAIL
 * layer adds on top of `kindOf`'s five (lib/setup/setup-rail.ts). Omit either
 * and the negative half of every assertion below silently stops
 * discriminating: a step that wrongly went Locked would still "pass" a check
 * that only knew about four words.
 *
 * Asserted on the entry's whole text rather than on the chip's own class
 * list. The chip is a `<span>` distinguished from the marker only by Tailwind
 * utilities, and pinning those here would make a purely visual refactor look
 * like a functional regression. None of the six strings is a substring of any
 * step title, help line, or locked hint, so a positive plus five negatives is
 * unambiguous.
 */
const STATES = [
  "Done", "To do", "Current", "Skipped", "Locked",
  "Couldn't check — reload to retry",
] as const;
type StepState = (typeof STATES)[number];

/**
 * The lead-in every locked surface prints, and the full comma-joined sentence
 * only the RAIL prints. Two message keys (`setup.goLive.blocked` and
 * `setup.locked.blockedBy`) worded identically on purpose — see
 * lib/messages.ts. Written out here so a copy change has to be a deliberate
 * edit to this spec.
 *
 * The split matters since the final review unified the two locked PANES on
 * one presentation: a pane says the lead-in once and then names its blockers
 * as buttons, so `GO_LIVE_BLOCKED`'s comma list survives only in the rail's
 * compact hint, where there are no buttons to carry the names.
 */
const BLOCKED_LEAD = "Finish these steps first:";
const GO_LIVE_BLOCKED =
  `${BLOCKED_LEAD} Business hours, Voice profile, Phone number, Test call`;

const RAIL_LABEL = "Setup steps";

// ---------------------------------------------------------------------------
// Locators. All three are structural (a role, an aria-label, an adjacent
// sibling) rather than class-based, so restyling the wizard cannot break them.
// ---------------------------------------------------------------------------

const rail = (page: Page) => page.getByRole("list", { name: RAIL_LABEL });
const railButtons = (page: Page) => rail(page).getByRole("button");
const railEntry = (page: Page, key: StepKey) => railButtons(page).nth(stepIndex(key));
/**
 * The SELECTED entry — `aria-current="true"`, not `"step"`.
 *
 * The two are different claims and this rail makes both. `aria-current="step"`
 * means "the current step in a process", which on this rail is `nextKey` — the
 * entry wearing the visible word "Current". Selection is wherever the operator
 * clicked, and can be any of the nine. The rail used to put `"step"` on the
 * selected entry, so a screen reader announced "Go live, current step" while
 * the Current chip sat on Business hours; `"true"` is the value that means
 * "the selected one in this set" and nothing more.
 */
const currentEntry = (page: Page) => rail(page).locator("button[aria-current='true']");

/**
 * The detail pane, as the rail's next sibling (setup-shell.tsx renders
 * `<SetupRail/>` then the pane `<div>` inside one grid). Located this way
 * because the pane carries no role, no landmark and no test id of its own —
 * and adding one purely for this file would be a product change made to suit
 * a test. Everything asserted "on the pane" below is scoped through here, so
 * a rail entry that happens to contain the same words can never satisfy it.
 */
const pane = (page: Page) => page.locator(`ol[aria-label="${RAIL_LABEL}"] + div`);
const paneHeading = (page: Page) => pane(page).getByRole("heading", { level: 2 });

/** Regex metacharacters — none of the nine titles contains one today, so this
 *  exists to keep that true rather than to fix anything. */
const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A rail entry's text starts with its MARKER, then the title. The marker is
 * `aria-hidden` but still lands in `textContent` (which is what `toHaveText`
 * reads), and it is either the two-digit step number or an icon — i.e. two
 * digits or nothing, depending on the state. Hence the optional group; the
 * alternative would be pinning the icon's presence per state, which is
 * exactly what `expectRailState` already does properly.
 */
const entryTextRe = (title: string) => new RegExp(`^(\\d{2})?${escapeRe(title)}`);

async function expectRailState(entry: Locator, expected: StepState) {
  await expect(entry).toContainText(expected);
  for (const other of STATES) {
    if (other !== expected) await expect(entry).not.toContainText(other);
  }
}

/** How many times `needle` appears in a locator's text. Used to PIN a known
 *  duplicate rather than merely tolerate it: `toContainText` cannot tell one
 *  occurrence from three, so a second copy of the blocked sentence would slip
 *  in unnoticed. */
async function countText(locator: Locator, needle: string): Promise<number> {
  const raw = (await locator.textContent()) ?? "";
  return raw.split(needle).length - 1;
}

/**
 * A value written onto `window` before a rail click and read back after it.
 * A full navigation — a server round trip of any kind that replaces the
 * document — mints a fresh `window` and wipes this; `history.pushState` plus a
 * `useSyncExternalStore` re-render does not. It is the whole architectural
 * claim of Design Phase 5 reduced to one observable fact.
 */
const SENTINEL = "bis-setup-p5";
type SentinelWindow = { __bisSetupSentinel?: string };

async function markWindow(page: Page) {
  await page.evaluate((token) => {
    (window as unknown as SentinelWindow).__bisSetupSentinel = token;
  }, SENTINEL);
}
async function readWindowMark(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (window as unknown as SentinelWindow).__bisSetupSentinel ?? null,
  );
}

/** Set in `beforeAll` so `afterAll` can clean up by id even when a test body
 *  never got to run (skip-unset-ids idiom — same as `calls.spec.ts`). */
let accountId = "";
/** `accounts.name` as it stood before this file touched it, and the name it
 *  is renamed TO. See the file banner for why the new one must also match
 *  `FIXTURE_ACCOUNT_RE`. */
let originalName = "";
let renamedTo = "";

test.describe("the setup wizard, as the agency", () => {
  /**
   * This spec's own preconditions, established rather than assumed — the same
   * beforeAll client-branding.spec.ts needs, for the same reason.
   * client-access.spec.ts deliberately leaves the fixture's client access OFF,
   * and "setup" sorts after it. The agency half below does not care, but the
   * client half does: a disabled account is redirected to /no-access, which
   * would look exactly like the agency-only redirect this file is testing and
   * would pass for entirely the wrong reason.
   *
   * The rename target is computed HERE, once, and never in a test body:
   * Playwright re-runs a body on retry and re-executes `beforeAll` in a fresh
   * worker, and a per-body stamp would leave the account under a different
   * name on each pass — the exact duplicate-fixture shape that bit the P4
   * spec. One stamp per worker, restored in `afterAll`.
   */
  test.beforeAll(async () => {
    const f = fixture();
    accountId = f.accountId;
    await setClientAccess(serviceDb(), accountId, true, f.clerkUserId);

    const { data, error } = await serviceDb()
      .from("accounts").select("name").eq("id", accountId).single();
    if (error) throw new Error(`setup spec: accounts.name read failed: ${error.message}`);
    originalName = (data as { name: string } | null)?.name ?? "";
    if (!originalName) {
      throw new Error("setup spec: the fixture account has no name to rename from");
    }
    // Another VALID fixture name, never an arbitrary string — see the banner.
    const stamp = Date.now();
    renamedTo = `E2E Client Co ${stamp}`;
    if (renamedTo === originalName) renamedTo = `E2E Client Co ${stamp + 1}`;
  });

  /**
   * Puts back everything this file changed.
   *
   * The name goes first and on its own: it is the one mutation whose leak
   * would outlive the account (see the banner), so it must not be skipped by
   * an earlier delete failing.
   *
   * Deletes every `checklist_items` and `calendars` row on the fixture
   * account — not merely the ones this run wrote. That is safe today only
   * because the fixture account is created fresh per run (banner, reason ①):
   * nothing else ever writes to either table on this account, so "every row
   * on it" and "every row this spec created" are the same set.
   *
   * `afterAll`, not a test body's own `finally`: a `finally` lives inside the
   * test function, and a per-test timeout can leave that function suspended
   * mid-await rather than unwound, so the `finally` never runs; Ctrl-C kills
   * the process outright and neither runs. `afterAll` is a separate hook
   * Playwright still invokes once the tests settle, same as `calls.spec.ts`
   * uses. It is not a complete fix — a killed *worker process* skips this too
   * — which is exactly why `checklist_items` was also added to
   * `fixtures/sweep.ts`'s cascade, and why the rename target above stays
   * sweepable.
   *
   * FK-child-first: `checklist_items` and `calendars` both reference
   * `accounts`; the former has NO cascade (migration 0007), so a leaked tick
   * row would make auth.teardown's account delete fail silently — a failure
   * mode this suite has already watched happen once.
   *
   * Errors are logged, not thrown: throwing here must not become a new way
   * for the suite to go red, and skip-unset-ids means this is a no-op when
   * `beforeAll` itself never ran.
   */
  test.afterAll(async () => {
    if (!accountId) return;
    const db = serviceDb();

    if (originalName) {
      const { error } = await db.from("accounts").update({ name: originalName }).eq("id", accountId);
      if (error) {
        console.error(`setup e2e cleanup: accounts.name restore failed: ${error.message}`);
      }
    }

    for (const table of ["checklist_items", "calendars"]) {
      const { error } = await db.from(table).delete().eq("account_id", accountId);
      if (error) {
        console.error(`setup e2e cleanup: ${table} delete failed: ${error.message}`);
      }
    }
  });

  const setupUrl = () => `/dashboard/accounts/${accountId}/setup`;

  /**
   * The smoke test, and it is not a formality.
   *
   * Design Phase 5 shipped a Critical in review that no gate could see: a
   * server component handed a FUNCTION to a client component
   * (steps/account.tsx → InlineField), which the Flight serializer refuses
   * with "Functions cannot be passed directly to Client Components" — a 500
   * on the whole page, at runtime, on every render regardless of which step
   * was selected. `tsc`, `eslint` and `next build` were all green through it.
   * An assertion that the page renders an `<h1>` at all is the regression
   * guard for that entire class of defect.
   *
   * The structural assertions ride along in the same page load: the rail is
   * exactly ten buttons in the canonical order, exactly one of them is
   * `aria-current="true"`, and exactly ONE `<h2>` exists in the document.
   */
  test("the page renders, and the rail is ten steps with exactly one current", async ({ page }) => {
    await page.goto(setupUrl());

    // The RSC-boundary regression guard. Everything below assumes a 200.
    await expect(page.getByRole("heading", { name: "Client setup", level: 1 })).toBeVisible();

    await expect(railButtons(page)).toHaveCount(10);
    // An exact, ORDERED set, not a count: the wizard's whole argument is that
    // it reads as one path from "nothing" to "live", so a step in the wrong
    // place is as wrong as a missing one — and two opposite errors cancelling
    // out is a shape this project has had to fix before.
    await expect(railButtons(page)).toHaveText(STEPS.map((s) => entryTextRe(s.title)));

    // Exactly one, not "at least one": two entries claiming to be the current
    // step is precisely what a selection bug looks like, and `toBeVisible` on
    // the first would sail past it.
    await expect(currentEntry(page)).toHaveCount(1);

    // Stated as a precondition rather than assumed, so the pre-selection
    // assertion below fails with a reason instead of a string diff. On the
    // fresh fixture `account` is hardcoded done and `branding` is done
    // because auth.setup.ts sets `brand_name`; the first NOT-done step is
    // therefore Business hours, which is what the wizard must open on
    // (DESIGN.md: "First incomplete step pre-selected").
    await expectRailState(railEntry(page, "account"), "Done");
    await expectRailState(railEntry(page, "branding"), "Done");
    await expect(railEntry(page, "hours")).toHaveAttribute("aria-current", "true");

    // ONE h2 in the whole document, not merely one in the pane: that is the
    // difference between "the other eight details are absent" and "the other
    // eight are hidden". Nothing else on this page renders an h2 — the page
    // header is an h1 and the sidebar has no headings at all.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);
    await expect(paneHeading(page)).toHaveText(stepTitle("hours"));

    // The other eight step details, proven ABSENT rather than hidden.
    // `toHaveCount(0)` is a DOM-membership claim; a `display:none` pane would
    // fail it. Each marker below is unique to one step's detail module:
    await expect(pane(page).getByRole("link", { name: "Open", exact: true })).toBeVisible();
    // ...and there is exactly ONE "Open" link in the document, though FIVE
    // step modules render one (branding, hours, voice_profile, number,
    // email). That single count is the aggregate proof for four of the eight.
    await expect(page.getByRole("link", { name: "Open", exact: true })).toHaveCount(1);
    // account (steps/account.tsx — the inline rename control)
    await expect(page.getByRole("button", { name: /^Edit Company name/ })).toHaveCount(0);
    // email (steps/email.tsx)
    await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
    // forwarding (steps/forwarding.tsx)
    await expect(page.getByRole("button", { name: "Forwarding is set up" })).toHaveCount(0);
    // test_call (steps/test-call.tsx)
    await expect(page.getByRole("link", { name: "View calls" })).toHaveCount(0);
    // go_live (steps/go-live.tsx). `exact` matters: the rail's own go_live
    // entry has an accessible name CONTAINING "Go live", and getByRole's
    // default substring match would find it and make this assertion
    // unsatisfiable forever.
    await expect(page.getByRole("button", { name: "Go live", exact: true })).toHaveCount(0);
  });

  /**
   * THE ARCHITECTURAL CLAIM OF DESIGN PHASE 5.
   *
   * setup-panel.tsx renders all ten step details server-side, once, and
   * setup-shell.tsx places exactly one of them into the tree — so a rail
   * click must be a pure client-side swap plus a `history.pushState`, NOT a
   * navigation. `useSetupStep` uses `pushState` rather than `router.push`
   * precisely to avoid re-rendering the server tree on every click.
   *
   * Proved with a `window` sentinel rather than by counting requests: server
   * actions POST to the CURRENT URL, background reads fire on their own
   * schedule, and matching a method+URL pair has already produced a
   * falsified pass in this suite (P2). A value on `window` survives
   * `pushState` and `popstate` and cannot survive a document replacement, so
   * it answers the actual question with no network guesswork at all.
   */
  test("selecting a step rewrites ?step= with no server round trip", async ({ page }) => {
    await page.goto(setupUrl());
    await markWindow(page);

    await railEntry(page, "email").click();
    await expect(page).toHaveURL(/[?&]step=email(&|$)/);
    await expect(paneHeading(page)).toHaveText(stepTitle("email"));
    expect(
      await readWindowMark(page),
      "a rail click must not replace the document — pushState only",
    ).toBe(SENTINEL);

    // Selection moved as one: the newly selected entry owns aria-current and
    // nothing else does.
    await expect(railEntry(page, "email")).toHaveAttribute("aria-current", "true");
    await expect(currentEntry(page)).toHaveCount(1);

    // The pane really swapped its CONTENT, not just its heading — the email
    // module's own control is here and the hours module's "Open" link count
    // is still one (email renders one too), so nothing accumulated.
    await expect(pane(page).getByRole("button", { name: "Skip for now" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);

    // A second selection, so Back has somewhere real to go.
    await railEntry(page, "forwarding").click();
    await expect(page).toHaveURL(/[?&]step=forwarding(&|$)/);
    await expect(paneHeading(page)).toHaveText(stepTitle("forwarding"));

    // Back walks the rail one step at a time (pushState, not replaceState) —
    // and is also same-document, so the sentinel survives it too.
    await page.goBack();
    await expect(page).toHaveURL(/[?&]step=email(&|$)/);
    await expect(paneHeading(page)).toHaveText(stepTitle("email"));
    await expect(railEntry(page, "email")).toHaveAttribute("aria-current", "true");
    expect(await readWindowMark(page)).toBe(SENTINEL);
  });

  /**
   * The URL is the single source of truth, so a cold load carrying `?step=`
   * has to land on that step — and a `?step=` naming nothing must not render
   * an empty pane. `parseStepParam` resolves both the server snapshot (null)
   * and any malformed value to the same default, and this is the only place
   * that behaviour is exercised through a real document load.
   */
  test("a cold load honours ?step=, and falls back rather than rendering nothing", async ({ page }) => {
    await page.goto(`${setupUrl()}?step=go_live`);
    await expect(paneHeading(page)).toHaveText(stepTitle("go_live"));
    await expect(railEntry(page, "go_live")).toHaveAttribute("aria-current", "true");
    await expect(currentEntry(page)).toHaveCount(1);

    // Garbage in the param. The URL is NOT rewritten (parseStepParam resolves
    // at render time), so the assertion is about what rendered, not about
    // where the browser ended up.
    await page.goto(`${setupUrl()}?step=nonsense`);
    await expect(paneHeading(page)).toHaveText(stepTitle("hours"));
    await expect(railEntry(page, "hours")).toHaveAttribute("aria-current", "true");
    // NON-EMPTY, stated as content rather than as "something is there": the
    // failure mode being guarded is a pane frame with no body in it, which a
    // heading-only assertion would happily accept.
    await expect(pane(page)).toContainText(
      "Enable the calendar and set open hours",
    );
    await expect(pane(page).getByRole("link", { name: "Open", exact: true })).toBeVisible();
  });

  /**
   * The rail is a list of real buttons, so it has to work from the keyboard —
   * arrow keys to move focus, Enter to select. setup-rail.tsx implements this
   * with an explicit `onKeyDown`, which means it is exactly as correct as it
   * is tested, and `.tsx` is unreachable from vitest.
   *
   * Starts on `account`, which is NOT the selected step, and moves to
   * `branding`, which is not either: `select()` returns early when the key
   * already matches (re-selecting would push a duplicate history entry), so
   * pressing Enter on the current step would prove nothing about Enter.
   */
  test("the rail is navigable by keyboard", async ({ page }) => {
    await page.goto(setupUrl());

    // .focus(), not .click() — a click would select as a side effect and the
    // ArrowDown below would then be moving from an already-selected entry.
    await railEntry(page, "account").focus();
    await expect(railEntry(page, "account")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(railEntry(page, "branding")).toBeFocused();
    // Focus moved; selection did NOT — the two are separate, and a rail that
    // selected on focus would make arrow-key browsing impossible.
    await expect(railEntry(page, "hours")).toHaveAttribute("aria-current", "true");

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]step=branding(&|$)/);
    await expect(paneHeading(page)).toHaveText(stepTitle("branding"));
    await expect(railEntry(page, "branding")).toHaveAttribute("aria-current", "true");
  });

  /**
   * NEVER A DEAD CLICK.
   *
   * A locked step stays a real, ENABLED button (setup-rail.tsx's own spec
   * decision) so its pane can explain the lock — and the pane names the
   * blockers as BUTTONS that select them, because naming what blocks a step
   * and then making the operator hunt for it in the rail is half an answer.
   *
   * Both preconditions are stated rather than assumed. `calls.spec.ts` and
   * `contacts-drawer.spec.ts` both seed a phone number and call rows onto
   * this same fixture account and delete them again (contacts-drawer's
   * cleanup says so explicitly, naming this file); a leaked row from a killed
   * run would unlock these steps for a reason that has nothing to do with the
   * wizard. Failing here says that out loud instead of failing on a confusing
   * string diff.
   */
  test("a locked step is reachable, and its pane names the blockers as buttons", async ({ page }) => {
    const db = serviceDb();

    const { data: preNumbers, error: numbersErr } = await db
      .from("phone_numbers").select("id").eq("account_id", accountId);
    if (numbersErr) throw new Error(`setup spec: phone_numbers read failed: ${numbersErr.message}`);
    expect(
      preNumbers ?? [],
      "the fixture account must start with no phone number — a leaked row would unlock test_call " +
      "and change the go-live blocked list",
    ).toHaveLength(0);

    const { data: preCalls, error: callsErr } = await db
      .from("calls").select("id").eq("account_id", accountId);
    if (callsErr) throw new Error(`setup spec: calls read failed: ${callsErr.message}`);
    expect(
      preCalls ?? [],
      "the fixture account must start with no calls — a leaked row would mark test_call done",
    ).toHaveLength(0);

    await page.goto(setupUrl());
    await markWindow(page);

    // --- test_call: locked, but not dead ---------------------------------
    const testCall = railEntry(page, "test_call");
    await expectRailState(testCall, "Locked");
    // The whole point of the spec decision: locked ≠ disabled.
    await expect(testCall).toBeEnabled();

    await testCall.click();
    await expect(page).toHaveURL(/[?&]step=test_call(&|$)/);
    await expect(paneHeading(page)).toHaveText(stepTitle("test_call"));

    const note = pane(page).getByRole("note");
    await expect(note).toContainText(BLOCKED_LEAD);
    // Ordered and exhaustive. `lockedPrereqKeys` returns them in rail order,
    // so voice_profile (04) precedes number (05).
    const blockers = note.getByRole("button");
    await expect(blockers).toHaveText([stepTitle("voice_profile"), stepTitle("number")]);

    // The blocker is a working selection, not a label that looks clickable.
    await blockers.first().click();
    await expect(page).toHaveURL(/[?&]step=voice_profile(&|$)/);
    await expect(paneHeading(page)).toHaveText(stepTitle("voice_profile"));
    await expect(railEntry(page, "voice_profile")).toHaveAttribute("aria-current", "true");
    // Same client-side swap as a rail click — the blocker buttons call the
    // same `select`, and this is what proves it rather than assuming it.
    expect(await readWindowMark(page)).toBe(SENTINEL);

    // --- go_live: locked, and the blocked sentence is COUNTED -------------
    await railEntry(page, "go_live").click();
    await expectRailState(railEntry(page, "go_live"), "Locked");
    await expect(paneHeading(page)).toHaveText(stepTitle("go_live"));
    await expect(pane(page)).toContainText(BLOCKED_LEAD);

    // Visible prose, not a `title` tooltip: a disabled button takes no
    // pointer events in several browsers and is out of the tab order, so an
    // operator staring at a dead button would have nothing to read.
    await expect(pane(page).getByRole("button", { name: "Go live", exact: true })).toBeDisabled();

    // THE COUNTS, RETARGETED — not loosened.
    //
    // Both locked panes now render ONE presentation: the lead-in once, then
    // each blocker as a button. go_live used to ALSO print `blockedReason` —
    // the same lead-in with the same titles comma-joined inside it — above
    // those buttons, so this file pinned every blocker title at TWO
    // occurrences to keep that duplication a deliberate decision. The final
    // review's verdict was that it read as a rendering bug on the pane an
    // operator sees most, so the duplicate sentence is gone and the number is
    // ONE. Still an exact count, and still the same discriminating assertion:
    // a reintroduced second copy fails it just as a missing lead-in does.
    expect(await countText(pane(page), BLOCKED_LEAD)).toBe(1);
    expect(await countText(pane(page), stepTitle("hours"))).toBe(1);
    await expect(pane(page).getByRole("note").getByRole("button")).toHaveText([
      stepTitle("hours"), stepTitle("voice_profile"), stepTitle("number"), stepTitle("test_call"),
    ]);
    // The comma-joined sentence did not disappear from the product — it is
    // the RAIL's go_live hint, which has no buttons to carry the names and so
    // still needs the prose form. Asserted here, on the entry, because this
    // is now the only surface that renders it: one derivation
    // (`lockedHint` ← `blockedReason`), exactly once.
    await expect(railEntry(page, "go_live")).toContainText(GO_LIVE_BLOCKED);
    expect(await countText(railEntry(page, "go_live"), BLOCKED_LEAD)).toBe(1);
  });

  /**
   * The website-assistant step: the numbered walkthrough for putting the
   * text assistant on a client's site (Setup step task — #103 shipped the
   * feature as a Voice-page card plus a checklist tick, which is not a
   * walkthrough).
   *
   * Runs in the SAME pre-change window as the locked-step test just above,
   * on purpose — that test's own go-live blocked list just named
   * "Voice profile" among the fixture's undone steps, which is exactly the
   * fact this test needs too. So the face this file can assert here is the
   * LOCKED one (setup-rail.ts's `lockedPrereqKeys("website_assistant")`
   * names voice_profile alone, unlike test_call's two) — a locked step is
   * reachable, never a dead end, so the pane's four-row walkthrough renders
   * right alongside the lock banner, same as the test_call/go_live case
   * above.
   */
  test("the website-assistant step's pane renders its four-row walkthrough, locked on the undone voice profile", async ({ page }) => {
    await page.goto(setupUrl());

    const websiteAssistant = railEntry(page, "website_assistant");
    await expectRailState(websiteAssistant, "Locked");
    // Never a dead click (the spec decision the test above this one already
    // pins) — locked still means enabled.
    await expect(websiteAssistant).toBeEnabled();

    await websiteAssistant.click();
    await expect(page).toHaveURL(/[?&]step=website_assistant(&|$)/);
    await expect(paneHeading(page)).toHaveText(stepTitle("website_assistant"));

    // Website assistant has exactly ONE prerequisite — voice_profile —
    // unlike test_call's two, so the note names it alone.
    const note = pane(page).getByRole("note");
    await expect(note).toContainText(BLOCKED_LEAD);
    await expect(note.getByRole("button")).toHaveText([stepTitle("voice_profile")]);

    // Four rows, still rendered underneath the lock banner.
    await expect(pane(page).locator('[data-row="1"]')).toContainText("Write the greeting and facts");
    await expect(pane(page).locator('[data-row="2"]')).toContainText("Publish a form for its leads");
    await expect(pane(page).locator('[data-row="3"]')).toContainText("Turn it on and pick the form");
    await expect(pane(page).locator('[data-row="4"]')).toContainText("Paste the code into the website");

    // Row 3 reads the not-done word — the account has no voice profile at
    // all yet, so concierge_enabled reads false regardless of anything else.
    await expect(pane(page).locator('[data-row="3"]')).toHaveAttribute("data-row-state", "open");
    await expect(pane(page).locator('[data-row="3"]')).toContainText("To do");

    // Row 4 while off: the line-to-paste sentence, never the embed script
    // itself (row 4 gates on nothing — it renders regardless of the lock —
    // but it is genuinely off here, since concierge_enabled is false).
    await expect(pane(page).locator('[data-row="4"]')).toContainText(
      "The line to paste appears here once it is on.",
    );

    // Row 3's link is the Voice page, anchored at the card this row turns on
    // and picks the form (voice-settings.tsx's `id="website-assistant"`).
    // Named by its accessible name, not the visible "Open" text: fix-round
    // MINOR 9 gave every row's link an `aria-label` of the row's own title
    // (website-assistant.tsx:78) so a screen reader can tell the four apart —
    // which means each link's accessible name is now that title, not "Open".
    await expect(
      pane(page).locator('[data-row="3"]')
        .getByRole("link", { name: m["setup.step.website_assistant.row3.title"] }),
    ).toHaveAttribute("href", `/dashboard/accounts/${accountId}/voice?from=setup#website-assistant`);
  });

  /**
   * The derived half: a step's state tracks the ROWS behind it, in both
   * directions, and the one manual tick this wizard has actually lands in the
   * database.
   *
   * Runs after the read-only tests above on purpose. It is the first test in
   * this file that changes what the wizard derives (hours becomes done, email
   * becomes skipped), and the locked-step assertions above depend on the
   * pre-change state.
   */
  test("hours that tell the truth, and an email skip that reaches the database", async ({ page }) => {
    const db = serviceDb();

    await page.goto(setupUrl());

    // --- THE HOURS REGRESSION GUARD --------------------------------------
    // Exit-gate call #1 greeted a real caller with "no availability" for
    // every day, from a calendar whose `open_hours` had been wiped while
    // everything upstream still said it was configured. `enabled` stayed
    // true throughout — which is exactly why "enabled means configured" is
    // the wrong question and this step asks a different one.
    //
    // The state is read off the RAIL entry, which shows it whatever step is
    // selected — so the reload cycle below never has to keep hours selected
    // to keep asserting on it. The expected word is "Current" rather than the
    // old "To do" because hours is the first not-done step and therefore the
    // one the rail rings (`setup.state.next`); that is a retarget, not a
    // loosening — "To do" is still in STATES and still asserted absent.
    const hours = railEntry(page, "hours");
    await expectRailState(hours, "Current");

    // Written through the service client, read back through the signed-in
    // agency user's own RLS-enforced session. That asymmetry is the point:
    // a grant the operator does not have makes this step go "Couldn't
    // check", and `expectRailState` fails rather than quietly passing.
    await getOrCreateCalendar(db, accountId, "e2e-setup-spec");
    await updateCalendarSettings(
      db, accountId,
      { enabled: true, openHours: { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]] } },
      "e2e-setup-spec",
    );
    await page.reload();
    await expectRailState(hours, "Done");

    // The wipe. `enabled` is untouched — only the windows go — so anything
    // reading the flag alone would still call this configured.
    await updateCalendarSettings(db, accountId, { openHours: {} }, "e2e-setup-spec");
    await page.reload();
    await expectRailState(hours, "Current");

    // And back, so the step is proven to track the rows in both directions
    // rather than merely having been red once.
    await updateCalendarSettings(
      db, accountId, { openHours: { mon: [["09:00", "17:00"]] } }, "e2e-setup-spec",
    );
    await page.reload();
    await expectRailState(hours, "Done");

    // --- The email skip tick persists ------------------------------------
    const email = railEntry(page, "email");
    await expectRailState(email, "To do");

    // The skip control lives in the PANE now, so the step has to be selected
    // before it exists in the DOM at all — which is itself the two-pane
    // wizard's contract restated.
    await email.click();
    await expect(paneHeading(page)).toHaveText(stepTitle("email"));
    await pane(page).getByRole("button", { name: "Skip for now" }).click();

    // The database, not the button. A button that changed state proves a
    // render; this proves the row `setSetupTickAction` was supposed to write
    // actually landed — and it is the thing a reload can read back.
    await expect
      .poll(
        async () => {
          const rows = await listChecklistState(db, accountId);
          return rows.some(
            (r) => r.item_key === SETUP_TICK_KEYS.emailSkipped && r.done_at !== null,
          );
        },
        { message: "the email-skipped tick should reach checklist_items" },
      )
      .toBe(true);

    // `?step=email` is in the URL from the click above, so the reload comes
    // back on the same pane — the deep-link behaviour, used rather than
    // separately asserted.
    await page.reload();
    await expectRailState(email, "Skipped");
    await expect(paneHeading(page)).toHaveText(stepTitle("email"));
    await expect(pane(page).getByRole("button", { name: "Un-skip" })).toBeVisible();

    // Skipping leaves the denominator rather than sitting in it forever —
    // the meter must be able to reach the end for an account that never
    // configures a sending identity. Ten steps total, one skipped, leaves
    // "of 9" (was "of 8" before website_assistant made it ten).
    await expect(page.getByRole("progressbar", { name: "Setup progress" }))
      .toHaveAttribute("aria-valuetext", /of 9 steps done$/);
  });

  /**
   * THE RENAME, AND WHY IT IS HERE RATHER THAN IN A UNIT TEST.
   *
   * `accounts.name` has NO UPDATE grant for the `authenticated` role:
   * migration 0013 revoked UPDATE on all of `accounts` and re-granted it
   * column by column for the seven BRANDING columns only. `name` was never
   * re-granted, so a write through `dbForRequest()` fails with "permission
   * denied for column \"name\"" on every real call. `renameAccountAction`
   * therefore writes through `serviceDb()` behind an agency-only guard —
   * and unit tests mock the db client, so they are blind to the grant and
   * would pass either way. This assertion is the only thing in the repo that
   * can catch a revert of that fix.
   *
   * The second half covers the other fix the same control carries: the
   * required-value rule had to become a serializable BOOLEAN prop rather
   * than a function, because a function across the server→client boundary is
   * a Flight serializer error that 500s the whole page. A blank submit that
   * produces an error toast — and leaves both the pane and the row alone —
   * is that rule still running on the client side of the boundary.
   */
  test("renaming the account writes accounts.name, and a blank name is refused", async ({ page }) => {
    const db = serviceDb();

    await page.goto(`${setupUrl()}?step=account`);
    await expect(paneHeading(page)).toHaveText(stepTitle("account"));

    // The display control's accessible name carries the VALUE as well as the
    // field, so this also asserts the pane rendered the CURRENT name.
    await expect(
      pane(page).getByRole("button", { name: `Edit Company name: ${originalName}`, exact: true }),
    ).toBeVisible();

    await pane(page).getByRole("button", { name: /^Edit Company name/ }).click();
    const input = pane(page).getByLabel("Company name", { exact: true });
    await input.fill(renamedTo);
    // Blur is the save path — Enter routes through it too (inline-field.tsx
    // blurs on Enter so there is one code path), so blurring directly is the
    // narrower of the two.
    await input.blur();

    await expect(page.getByText("Company name saved")).toBeVisible();
    // THE ACTUAL POINT. A toast proves a response; this proves the write
    // landed in a column the signed-in role cannot touch.
    await expect
      .poll(
        async () => {
          const { data } = await db.from("accounts").select("name").eq("id", accountId).single();
          return (data as { name: string } | null)?.name ?? null;
        },
        { message: "renameAccountAction must write accounts.name through serviceDb()" },
      )
      .toBe(renamedTo);

    // --- whitespace-only is refused, everywhere --------------------------
    await pane(page).getByRole("button", { name: /^Edit Company name/ }).click();
    const blankInput = pane(page).getByLabel("Company name", { exact: true });
    await blankInput.fill("   ");
    await blankInput.blur();

    await expect(page.getByText("A company needs a name — this one can't be blank.")).toBeVisible();
    // The pane is unchanged: still the account step, still showing the value
    // that is actually stored — not blanked out optimistically.
    await expect(paneHeading(page)).toHaveText(stepTitle("account"));
    await expect(
      pane(page).getByRole("button", { name: `Edit Company name: ${renamedTo}`, exact: true }),
    ).toBeVisible();

    // A reload before the row is read back, deliberately: it is a real round
    // trip, so anything the rejected submit might have put in flight has
    // either landed (and would show here) or never existed. Reading the row
    // immediately after the toast could pass against a write still on its
    // way.
    await page.reload();
    await expect(
      pane(page).getByRole("button", { name: `Edit Company name: ${renamedTo}`, exact: true }),
    ).toBeVisible();
    const { data, error } = await db
      .from("accounts").select("name").eq("id", accountId).single();
    if (error) throw new Error(`setup spec: accounts.name read-back failed: ${error.message}`);
    expect(
      (data as { name: string } | null)?.name,
      "a rejected rename must leave the stored name alone",
    ).toBe(renamedTo);
  });
});

/**
 * The other half of the boundary. Navigation hides Setup from a client, but
 * hiding a link is not authorization — a client who knows the URL still
 * satisfies `requireAccountAccess` for their own account, and RLS along with
 * it. `requireAgencyOnlyAccountAccess` is the thing that actually says no, and
 * this is the only place it is exercised against a real client session.
 */
test.describe("a client cannot reach the setup wizard", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("the URL redirects to their own dashboard and the nav never offers it", async ({ page }) => {
    const { accountId: id } = fixture();

    await page.goto(`/dashboard/accounts/${id}/setup`);
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/accounts/${id}/dashboard$`),
    );
    // Not a 403 and not a 404: the redirect must land somewhere real, with a
    // working nav. Without this, a redirect into an error page — or a sidebar
    // that failed to render at all — would satisfy every absence check below.
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("link", { name: "Calls", exact: true })).toBeVisible();

    // The absence checks, which only mean anything BECAUSE the positive one
    // above passed — an empty sidebar would satisfy them just as happily.
    await expect(sidebar.getByRole("link", { name: "Setup", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Voice", exact: true })).toHaveCount(0);
  });
});
