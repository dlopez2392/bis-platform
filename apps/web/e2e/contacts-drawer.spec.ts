import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, setClientAccess, createContact, ensureDefaultPipeline, createOpportunity,
  assignPhoneNumber, startCallRow, finishCallRow,
} from "@bis/db";
import { readClientFixture } from "./support";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next.js request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * P4 built the contacts table, the peek drawer, bulk selection/tag/delete,
 * and calls-table keyboard parity — all client-side interaction with no DOM
 * in web's own vitest suite. This file is the ONLY real proof any of it
 * works: drawer open/close/deep-link, inline-edit mutations, bulk selection
 * across pages, tag apply/undo, delete's typed-count gate and its honest
 * skipped-count reporting, and calls-row keyboard nav — none of that is
 * provable without a real browser.
 *
 * ALL mutations run on the per-run CLIENT FIXTURE account (auth.setup.ts
 * creates it, auth.teardown.ts deletes it unconditionally) — never on
 * `Test Client One` (CLAUDE.md hard rule; one Supabase project means an e2e
 * write to the shared seeded account is a production write).
 *
 * Fixture rows this file needs (two contacts to swap the drawer between, a
 * row for the Space-key proof, two for the retry race, 21 to force a second
 * table page, a delete-blocked contact plus a free one, a pre-existing tag,
 * one phone number and two call rows) are seeded ONCE in `beforeAll` via
 * `@bis/db` — the same helpers the app itself calls, so every row has the
 * shape production writes rather than one this spec invented. Contacts
 * needed by name are found through `?q=` search rather than raw table
 * position: `ContactsTable` paginates CLIENT-SIDE (20/page) over whatever
 * `listContacts` returned, so a specific seeded row is only guaranteed to be
 * in the DOM at all if either it is the newest thing on the account (true
 * for anything created live, mid-test, through the UI) or the search box has
 * narrowed the list down to it. Getting this wrong doesn't fail loudly —
 * `.filter({ hasText })` on zero elements just times out waiting for a row
 * that was created successfully but paged off-screen.
 *
 * IMPORTANT CLEANUP NOTE — this is NOT merely tidiness. `opportunities`,
 * `pipelines`/`pipeline_stages`, and `tags` all carry a plain (NO ACTION)
 * `account_id` reference to `accounts` (migration 0003_crm_core.sql), and
 * `deleteAccountCascade` (fixtures/sweep.ts, what auth.teardown.ts's
 * unconditional final cleanup runs) does not touch any of those three
 * tables. Leaving the opportunity or pipeline this file creates in place
 * would make the FINAL `accounts` delete fail outright — not just leave a
 * stray row, but strand the real Clerk user and org this run created. This
 * file's own `afterAll` deletes them itself, in FK order (opportunities,
 * which reference the pipeline, before the pipeline).
 */
test.describe.configure({ timeout: 180_000 });

const fixture = readClientFixture();
test.skip(!fixture, "client fixture missing — auth.setup did not run");

const base = () => `/dashboard/accounts/${fixture!.accountId}`;

type ClientFixtureFull = { accountId: string; clerkUserId: string };
function fullFixture(): ClientFixtureFull {
  return JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixtureFull;
}

const stamp = Date.now();
const ACTOR = "e2e-contacts-drawer";

let accountId = "";
let deeplinkAId = "";
let deeplinkBId = "";
let retryAId = "";
const pagingIds: string[] = [];
let blockedId = "";
let opportunityId = "";
let pipelineId = "";
const seededTagName = "vip-e2e";
let callLinkContactId = "";

/**
 * Makes `beforeAll` below safe to run more than once against the SAME
 * account. That happens for real, not hypothetically: Playwright can
 * respawn a fresh worker to retry a failing test in this file, and
 * `beforeAll` is worker-scoped — it re-executes for that new worker, same
 * accountId, same fixture file. Without this, a second pass mints a SECOND
 * "SpaceKey Target", a SECOND "Retry A"/"Retry B", etc — exactly the strict-
 * mode violations this file hit (2x "SpaceKey Target", 4x "Retry A").
 *
 * Scoped tightly to what THIS `beforeAll` creates: the fixture account is
 * minted brand-new per run by auth.setup.ts, so nothing else legitimately
 * owns an opportunity/pipeline/tag/call/phone_number on it, and none of the
 * first names deleted below collide with what TEST BODIES create live
 * through the UI ("Drawer", "Tag", "Bulk" — never "Deeplink", "SpaceKey",
 * "Retry", "BulkGate", "CallLink", or "Paging"). FK order matters:
 * opportunities reference contacts with NO `on delete` clause (migration
 * 0003_crm_core.sql) and the pipeline, so they must go first; pipelines
 * cascade their own stages.
 */
async function clearOwnFixtures(db: ReturnType<typeof serviceDb>, accId: string) {
  const { error: oppErr } = await db.from("opportunities").delete().eq("account_id", accId);
  if (oppErr) throw new Error(`contacts-drawer e2e: pre-clean opportunities failed: ${oppErr.message}`);
  const { error: pplErr } = await db.from("pipelines").delete().eq("account_id", accId);
  if (pplErr) throw new Error(`contacts-drawer e2e: pre-clean pipelines failed: ${pplErr.message}`);
  const { error: tagErr } = await db.from("tags").delete().eq("account_id", accId);
  if (tagErr) throw new Error(`contacts-drawer e2e: pre-clean tags failed: ${tagErr.message}`);
  const { error: callErr } = await db.from("calls").delete().eq("account_id", accId);
  if (callErr) throw new Error(`contacts-drawer e2e: pre-clean calls failed: ${callErr.message}`);
  const { error: numErr } = await db.from("phone_numbers").delete().eq("account_id", accId);
  if (numErr) throw new Error(`contacts-drawer e2e: pre-clean phone_numbers failed: ${numErr.message}`);
  const { error: contactErr } = await db.from("contacts").delete()
    .eq("account_id", accId)
    .in("first_name", ["Deeplink", "SpaceKey", "Retry", "BulkGate", "CallLink", "Paging"]);
  if (contactErr) throw new Error(`contacts-drawer e2e: pre-clean contacts failed: ${contactErr.message}`);
}

test.beforeAll(async () => {
  const full = fullFixture();
  accountId = full.accountId;
  const db = serviceDb();

  // This spec's own precondition, established rather than assumed — same
  // reasoning as calls.spec.ts / setup.spec.ts: client-access.spec.ts
  // deliberately leaves client_access_enabled OFF and never restores it, and
  // in a FULL suite run it may run before this file. Running this file
  // alone never hits that path, but restoring it here makes the "P4 client
  // session" describe block below correct regardless of run order.
  await setClientAccess(db, accountId, true, full.clerkUserId);

  // Idempotency — see clearOwnFixtures above.
  await clearOwnFixtures(db, accountId);

  // Addition A: two contacts to swap the drawer between via a deep link
  // plus a real in-app open().
  deeplinkAId = (await createContact(db, accountId, { firstName: "Deeplink", lastName: "One" }, ACTOR)).id;
  deeplinkBId = (await createContact(db, accountId, { firstName: "Deeplink", lastName: "Two" }, ACTOR)).id;

  // Addition B: a dedicated row for the Space-key checkbox proof. Found by
  // search below, not by id.
  await createContact(db, accountId, { firstName: "SpaceKey", lastName: "Target" }, ACTOR);

  // Addition C: two contacts for the drawer retry race. Only A's id is
  // needed (to route its summary endpoint); B is found by search below.
  retryAId = (await createContact(db, accountId, { firstName: "Retry", lastName: "A" }, ACTOR)).id;
  await createContact(db, accountId, { firstName: "Retry", lastName: "B" }, ACTOR);

  // Addition F: one contact an opportunity makes delete-blocked, one free.
  blockedId = (await createContact(db, accountId, { firstName: "BulkGate", lastName: "Blocked" }, ACTOR)).id;
  await createContact(db, accountId, { firstName: "BulkGate", lastName: "Free" }, ACTOR);
  const pipeline = await ensureDefaultPipeline(db, accountId);
  pipelineId = pipeline.pipelineId;
  const opp = await createOpportunity(
    db, accountId, { contactId: blockedId, pipelineId, name: "BulkGate Deal" }, ACTOR,
  );
  opportunityId = opp.id;

  // Addition E: a tag that must already be in the Add-tag dropdown.
  const { error: tagErr } = await db.from("tags").insert({ account_id: accountId, name: seededTagName });
  if (tagErr) throw new Error(`contacts-drawer e2e: seed tag failed: ${tagErr.message}`);

  // Addition D: enough contacts to force a second table page (PAGE_SIZE = 20
  // in contacts-table.tsx). This test locates rows by POSITION, not name, so
  // nothing else depends on these ids beyond their count.
  for (let i = 0; i < 21; i++) {
    const c = await createContact(
      db, accountId, { firstName: "Paging", lastName: `Item ${i + 1}` }, ACTOR,
    );
    pagingIds.push(c.id);
  }

  // Addition G: one phone number and two calls — one linked to a contact
  // (the contact-link-not-call-row proof), one not (the keyboard-nav
  // partner row). Same helper chain the voice route itself calls
  // (assignPhoneNumber -> startCallRow -> finishCallRow), same reasoning
  // calls.spec.ts documents: the row under test has the shape production
  // writes.
  const number = await assignPhoneNumber(
    db, accountId, { e164: `+1555${String(stamp).slice(-7)}`, status: "testing" }, ACTOR,
  );
  callLinkContactId = (await createContact(
    db, accountId, { firstName: "CallLink", lastName: "Target" }, ACTOR,
  )).id;

  const plain = await startCallRow(db, accountId, {
    phoneNumberId: number.id, callerE164: `+1556${String(stamp).slice(-7)}`,
  });
  await finishCallRow(db, accountId, plain.id, {
    outcome: "lead", endedAt: new Date(), durationSecs: 42, turnCount: 1,
    transcript: [], summary: "Plain call, e2e", language: "en",
  });

  const linked = await startCallRow(db, accountId, {
    phoneNumberId: number.id, callerE164: `+1557${String(stamp).slice(-7)}`,
  });
  await finishCallRow(db, accountId, linked.id, {
    outcome: "lead", endedAt: new Date(), durationSecs: 58, turnCount: 1,
    transcript: [], summary: "Linked call, e2e", language: "en", contactId: callLinkContactId,
  });
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  // Order matters — see the file banner. Opportunities reference the
  // pipeline, so they must go first; deleting the pipeline cascades its
  // stages (pipeline_stages.pipeline_id is ON DELETE CASCADE). Errors are
  // logged, not thrown — same reasoning as every other fixture-account
  // spec's cleanup: this must not become a new way for the suite to go red
  // — but a genuine failure here is worth knowing about, since it will make
  // the FINAL account teardown fail too.
  for (const [table, column, value] of [
    ["opportunities", "id", opportunityId],
    ["pipelines", "id", pipelineId],
  ] as const) {
    if (!value) continue;
    const { error } = await db.from(table).delete().eq(column, value);
    if (error) console.error(`contacts-drawer e2e cleanup: ${table} delete failed: ${error.message}`);
  }
  {
    const { error } = await db.from("tags").delete().eq("account_id", accountId);
    if (error) console.error(`contacts-drawer e2e cleanup: tags delete failed: ${error.message}`);
  }
  // The phone number this file assigned must go back NOW, not at teardown.
  // `deleteAccountCascade` would get it eventually, but "eventually" is after
  // the whole suite: setup.spec.ts runs later in the same run and asserts the
  // fixture account starts with NO phone number (its go-live blocked list
  // changes if one exists), so a row left standing here fails a spec that has
  // nothing to do with P4. Calls reference phone_numbers, so they go first.
  for (const table of ["calls", "phone_numbers"] as const) {
    const { error } = await db.from(table).delete().eq("account_id", accountId);
    if (error) console.error(`contacts-drawer e2e cleanup: ${table} delete failed: ${error.message}`);
  }
  // contacts are cleaned by auth.teardown.ts's deleteAccountCascade
  // regardless — left to it rather than duplicated.
});

test.describe("P4 contacts table + drawer (agency session)", () => {
  test("row click opens the drawer; Esc and Back both close it; reload re-opens a deep link", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    await page.getByRole("button", { name: /add contact/i }).click();
    await page.getByLabel(/first name/i).fill("Drawer");
    await page.getByLabel(/last name/i).fill("Target");
    await page.getByRole("button", { name: /save|create/i }).click();
    await expect(page.getByText("Drawer Target")).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: "Drawer Target" }).first();
    await row.click();
    await expect(page).toHaveURL(/peek=/);
    await expect(page.getByRole("dialog")).toBeVisible(); // Sheet renders role=dialog
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).not.toHaveURL(/peek=/);

    // reopen, then Back closes
    await row.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // refresh with ?peek= present re-opens the drawer (spec: deep-linked peek)
    await row.click();
    await expect(page).toHaveURL(/peek=/);
    await page.reload();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  // Addition A (T5 review): the popstate pushed-reset fix. A deep-linked
  // arrival never pushed a history entry of its own, so its `close()` must
  // strip `?peek=` in PLACE (replaceState) — not walk history backwards,
  // which is what happens if a later push's `pushed = true` survives a real
  // browser Back that already consumed it.
  test("a deep-linked drawer swaps via a real open(); Back restores the first; Esc strips the param in place", async ({ page }) => {
    await page.goto(`${base()}/contacts?q=Deeplink&peek=${deeplinkAId}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible(); // opened after hydration, no click involved
    await expect(dialog.getByText("Deeplink One", { exact: true })).toBeVisible();

    // Radix's Dialog (the Sheet) marks the rest of the page aria-hidden while
    // open, so a role="row" locator resolves to nothing here — not a timing
    // issue, the accessibility tree genuinely excludes it. `data-contact-row`
    // (contacts-table.tsx) is a plain attribute, unaffected by aria-hidden,
    // so it is the correct way to find a row while a drawer sits over it.
    const rowB = page.locator(`[data-contact-row="${deeplinkBId}"]`);
    await expect(rowB).toBeVisible();
    // A real click here would land on the Sheet's full-viewport overlay —
    // `fixed inset-0 z-50`, by design, so an outside click closes the
    // drawer — rather than on the row underneath it. dispatchEvent fires the
    // row's own onClick handler directly, the exact code path open() runs
    // through, without fighting that (correct, unrelated) modal behaviour.
    await rowB.dispatchEvent("click");
    await expect(dialog.getByText("Deeplink Two", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`peek=${deeplinkBId}`));

    await page.goBack();
    await expect(dialog.getByText("Deeplink One", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`peek=${deeplinkAId}`));

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The pin: without the popstate listener resetting `pushed`, this Esc
    // would call history.back() a SECOND time (still believing it owns the
    // entry the click above pushed) and navigate off the contacts page
    // entirely, instead of stripping `peek` from the current entry in place.
    const url = new URL(page.url());
    expect(url.pathname.endsWith("/contacts")).toBe(true);
    expect(url.searchParams.has("peek")).toBe(false);
  });

  // Addition B (T5 review): jsdom cannot prove the Space -> synthesized
  // click path a real browser runs when a focused <button role="checkbox">
  // receives a Space keypress. It must toggle the checkbox and, because
  // TableCell's onClick stopPropagation stops that synthesized click from
  // ever reaching the row's own onClick, must NOT open the drawer.
  test("Space on a row's checkbox toggles selection without opening the drawer", async ({ page }) => {
    await page.goto(`${base()}/contacts?q=SpaceKey`);
    const checkbox = page.getByRole("row").filter({ hasText: "SpaceKey Target" }).getByRole("checkbox");
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("inline edit saves for real - reload proves it (mutation check)", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    await page.getByRole("row").filter({ hasText: "Drawer Target" }).first().click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: /edit company/i }).click();
    await drawer.getByLabel(/company/i).fill("Painted Proof LLC");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    // The URL still carries `?peek=` from the click above, so reload doesn't
    // land on a bare table — use-peek.ts's deep-link behavior (proved by the
    // earlier test in this file) re-opens the SAME drawer straight from
    // hydration. Re-clicking a role="row" locator here would hang: the Sheet
    // that's already open marks the rest of the page aria-hidden, so the row
    // locator resolves to nothing. Assert straight on the drawer that's
    // already open instead of trying to reopen it.
    await page.reload();
    await expect(page.getByRole("dialog").getByText("Painted Proof LLC")).toBeVisible();
  });

  test("keyboard: focused row opens on Enter, arrows move focus", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    const firstRow = page.locator("tbody tr").first();
    await firstRow.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("tbody tr").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(firstRow).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  // Addition C (T6 review): the retry race. contact-drawer.tsx's effect
  // captures a `stale` flag per run and marks it true in its cleanup, which
  // fires whenever `contactId` changes — the guard against a slow retry's
  // late response clobbering whatever contact is now on screen. Retry A
  // (routed to a real, DELAYED response) fires the slow fetch, then this
  // test switches away to B (unrouted) and waits past A's delay window: B
  // must still be showing loaded content, never a reverted skeleton.
  test("drawer retry: a slow retry never leaves a different row stuck mid-flight", async ({ page }) => {
    await page.goto(`${base()}/contacts?q=Retry`);
    const pattern = `**/contacts/${retryAId}/summary`;

    await page.route(pattern, (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));

    const rowA = page.getByRole("row").filter({ hasText: "Retry A" });
    await rowA.click();
    const dialogA = page.getByRole("dialog");
    await expect(dialogA).toBeVisible();
    await expect(dialogA.getByText(m["drawer.loadFailed"])).toBeVisible();

    await page.unroute(pattern);
    const DELAY_MS = 2000;
    await page.route(pattern, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      await route.continue();
    });

    await dialogA.getByRole("button", { name: m["common.retry"] }).click();

    // Close A — the overlay would block a real click on row B anyway (see
    // the deep-link test's own comment on this), and this is the realistic
    // path besides: retry fires the delayed fetch, the user gives up on A
    // and looks at someone else while it is still in flight.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const rowB = page.getByRole("row").filter({ hasText: "Retry B" });
    await rowB.click();
    const dialogB = page.getByRole("dialog");
    await expect(dialogB.getByText("Retry B", { exact: true })).toBeVisible();
    await expect(dialogB.getByTestId("drawer-skeleton")).toHaveCount(0);
    await expect(dialogB.getByText("Recent", { exact: true })).toBeVisible();

    // Wait past A's delayed response window. Without the `stale` guard, A's
    // late .then() would setFetched keyed to A's own (closed-over)
    // contactId, and the component's own contactId/fetched.contactId
    // mismatch check would then fall back to the LOADING skeleton — not
    // A's data, but a regression from B's already-loaded content all the
    // same. A fixed wait is the only way to prove a response that never
    // arrives at all: there is no UI event to wait on for "nothing happens".
    await page.waitForTimeout(DELAY_MS + 1000);

    await expect(dialogB.getByText("Retry B", { exact: true })).toBeVisible();
    await expect(dialogB.getByText(m["drawer.loadFailed"])).toHaveCount(0);
    await expect(dialogB.getByTestId("drawer-skeleton")).toHaveCount(0);

    await page.unroute(pattern);
  });

  // Addition D (T7 review): the bulk bar's own visibility rule, the header
  // checkbox's tri-state (including indeterminate at partial selection),
  // and cross-page selection surviving a page change — `selected` lives in
  // ContactsTable's own state, entirely independent of the `page` state
  // that drives which 20 rows are currently rendered.
  test("bulk bar: appears/hides with selection; header checkbox is tri-state; selection survives paging", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar).toHaveCount(0);

    const firstRowCheckbox = page.locator("tbody tr").first().getByRole("checkbox");
    await firstRowCheckbox.click();
    await expect(bar).toBeVisible();
    await expect(bar.getByText("1 selected")).toBeVisible();

    const headerCheckbox = page.locator("thead").getByRole("checkbox");
    await expect(headerCheckbox).toHaveAttribute("aria-checked", "mixed");

    await firstRowCheckbox.click();
    await expect(bar).toHaveCount(0);

    await headerCheckbox.click();
    await expect(headerCheckbox).toHaveAttribute("aria-checked", "true");
    await expect(bar.getByText("20 selected")).toBeVisible();
    const pageCheckboxes = page.locator("tbody tr").getByRole("checkbox");
    await expect(pageCheckboxes).toHaveCount(20);
    await expect(pageCheckboxes.first()).toHaveAttribute("aria-checked", "true");
    await expect(pageCheckboxes.last()).toHaveAttribute("aria-checked", "true");

    await headerCheckbox.click();
    await expect(bar).toHaveCount(0);

    // Cross-page selection.
    await firstRowCheckbox.click();
    await expect(bar.getByText("1 selected")).toBeVisible();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(/Page 2 of/)).toBeVisible();
    const page2FirstCheckbox = page.locator("tbody tr").first().getByRole("checkbox");
    await page2FirstCheckbox.click();
    await expect(bar.getByText("2 selected")).toBeVisible();

    await page.getByRole("button", { name: "Prev", exact: true }).click();
    await expect(page.getByText(/Page 1 of/)).toBeVisible();
    await expect(bar.getByText("2 selected")).toBeVisible();
    await expect(firstRowCheckbox).toHaveAttribute("aria-checked", "true");

    await bar.getByRole("button", { name: m["bulk.clear"] }).click();
    await expect(bar).toHaveCount(0);
  });

  // Addition E (T7 review): a pre-existing tag in the Add-tag dropdown
  // applies to the whole selection with an honest count and a working undo;
  // a free-text one, once created, has to round-trip through the server
  // (`existingTags` is a page-level server prop, revalidated by the action
  // — not client state) to show up on reopen.
  test("bulk tags: an existing tag applies to everyone selected; a free-text one appears on reopen", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    await page.getByRole("button", { name: /add contact/i }).click();
    await page.getByLabel(/first name/i).fill("Tag");
    await page.getByLabel(/last name/i).fill("Target");
    await page.getByRole("button", { name: /save|create/i }).click();
    const row = page.getByRole("row").filter({ hasText: "Tag Target" });
    await expect(row).toBeVisible();

    // Capture the id via the drawer's own "open full page" link — the table
    // never renders one directly — so the undo step below can poll the
    // record itself instead of guessing how long a fire-and-forget server
    // action takes to land.
    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const fullHref = await dialog.getByRole("link", { name: m["drawer.openFull"] }).getAttribute("href");
    const tagTargetId = fullHref!.split("/").pop()!;
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await row.getByRole("checkbox").click();
    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar.getByText("1 selected")).toBeVisible();

    await bar.getByRole("button", { name: m["bulk.addTag"] }).click();
    const existingItem = page.getByRole("menuitem", { name: seededTagName });
    await expect(existingItem).toBeVisible();
    await existingItem.click();
    await expect(page.getByText(`Tagged 1 contacts with "${seededTagName}"`)).toBeVisible();

    await page.getByRole("button", { name: m["common.undo"] }).click();
    // NOT `${base()}/contacts/.../summary` — `base()` is the DASHBOARD PAGE
    // prefix (/dashboard/accounts/<id>), which has no `/summary` route at
    // all. That mismatch was this file's own bug, not an app defect: the
    // request 404'd into not-found.tsx's HTML, and `.json()` on an HTML body
    // is exactly the "Unexpected token '<'" SyntaxError this file hit. The
    // real summary endpoint contact-drawer.tsx itself fetches lives under
    // /api/accounts/<id>/contacts/<id>/summary (see the route file).
    await expect.poll(async () => {
      const res = await page.request.get(`/api/accounts/${accountId}/contacts/${tagTargetId}/summary`);
      const body = (await res.json()) as { tags: { name: string }[] };
      return body.tags.some((t) => t.name === seededTagName);
    }, { message: "undo should remove the seeded tag from the contact's own record" }).toBe(false);

    // Free-text create, then close and reopen the dropdown.
    await row.getByRole("checkbox").click();
    await bar.getByRole("button", { name: m["bulk.addTag"] }).click();
    const draftTag = `fresh-tag-${Date.now()}`;
    await page.getByPlaceholder(m["contact.addTag"]).fill(draftTag);
    await page.keyboard.press("Enter");
    await expect(page.getByText(`Tagged 1 contacts with "${draftTag}"`)).toBeVisible();

    await page.keyboard.press("Escape");
    await row.getByRole("checkbox").click();
    await bar.getByRole("button", { name: m["bulk.addTag"] }).click();
    await expect(page.getByRole("menuitem", { name: draftTag })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("bulk delete: the typed count gates the button for real", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    for (const [first, last] of [["Bulk", "One"], ["Bulk", "Two"]] as const) {
      await page.getByRole("button", { name: /add contact/i }).click();
      await page.getByLabel(/first name/i).fill(first);
      await page.getByLabel(/last name/i).fill(last);
      await page.getByRole("button", { name: /save|create/i }).click();
      await expect(page.getByText(`${first} ${last}`)).toBeVisible();
    }
    for (const name of ["Bulk One", "Bulk Two"]) {
      await page.getByRole("row").filter({ hasText: name }).getByRole("checkbox").click();
    }
    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar.getByText("2 selected")).toBeVisible();

    await bar.getByRole("button", { name: /delete/i }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: /delete 2 contacts/i });
    // Wrong count leaves the button disabled — the gate is real.
    await dialog.getByRole("textbox").fill("1");
    await expect(dialog.getByRole("button", { name: /delete/i })).toBeDisabled();
    await dialog.getByRole("textbox").fill("2");
    await dialog.getByRole("button", { name: /delete/i }).click();
    await expect(page.getByText("Deleted 2 contacts")).toBeVisible();
    await expect(page.getByText("Bulk One")).toHaveCount(0);
    await expect(page.getByText("Bulk Two")).toHaveCount(0);
  });

  // Addition F (T7 review): deleteContacts' skip-blocked path. "BulkGate
  // Blocked" carries an opportunity (contact_id is a plain, NO ACTION
  // reference — migration 0003), so a batch delete including it must delete
  // the free one, skip the blocked one, and SAY so — not silently drop it
  // from the count, and not fail the whole batch either.
  test("bulk delete: a linked contact is skipped honestly, not silently deleted", async ({ page }) => {
    await page.goto(`${base()}/contacts?q=BulkGate`);
    for (const name of ["BulkGate Blocked", "BulkGate Free"]) {
      await page.getByRole("row").filter({ hasText: name }).getByRole("checkbox").click();
    }
    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar.getByText("2 selected")).toBeVisible();

    await bar.getByRole("button", { name: /delete/i }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: /delete 2 contacts/i });
    await dialog.getByRole("textbox").fill("2");
    await dialog.getByRole("button", { name: /delete/i }).click();

    await expect(page.getByText(
      "Deleted 1 · skipped 1 linked to bookings, deals, or conversations",
    )).toBeVisible();
    await expect(page.getByText("BulkGate Free")).toHaveCount(0);
    await expect(page.getByText("BulkGate Blocked")).toBeVisible();
  });

  // Brief + Addition G (T9 review): the contact link inside a call row must
  // go to the contact, not the call (StopPropagation around it is what makes
  // that true rather than merely intended), and keyboard parity must match
  // the contacts table's own row nav.
  test("calls: the contact link opens the contact, not the call; keyboard nav matches the CRM", async ({ page }) => {
    await page.goto(`${base()}/calls`);
    const rowWithContact = page.locator("tbody tr").filter({ hasText: "CallLink Target" });
    await expect(rowWithContact).toBeVisible();

    await rowWithContact.getByRole("link", { name: "CallLink Target" }).click();
    await expect(page).toHaveURL(new RegExp(`/contacts/${callLinkContactId}$`));
    await expect(page).not.toHaveURL(/\/calls\//);

    await page.goto(`${base()}/calls`);
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await rows.nth(0).focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rows.nth(0)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/calls\/[0-9a-f-]{36}$/);
  });
});

test.describe("P4 client session (RLS proof)", () => {
  // Same storageState idiom as client-access.spec.ts — the CLIENT's cookie jar.
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client session's drawer summary read succeeds on its own contact", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    const row = page.locator("tbody tr").first();
    await row.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    // Grants proof: the summary fetch resolved into content, not the error
    // state — serviceDb unit fixtures cannot see grants, only this can.
    await expect(drawer.getByText(m["drawer.loadFailed"])).toHaveCount(0);
    await expect(drawer.getByText("Recent", { exact: true })).toBeVisible();
  });
});
