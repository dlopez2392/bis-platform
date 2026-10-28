import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { test, expect, type Page } from "./fixtures/test";
import { serviceDb, deleteContacts } from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase from
// the Playwright runner process rather than through a Next.js request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * Plan Task 13 (contact archive and internal-only delete, 2026-10-28): the ONLY real-browser proof that
 * archiving a contact from the list runs AT ONCE with an Undo (DESIGN.md rule 6), that the Archived view
 * (`?view=archived`) shows exactly what was archived and empties once the last one is restored, and that
 * restoring hands it back to the active list. `bulk-action-bar.test.ts` and `archive-controls.test.ts`
 * prove the client-side wiring with no DOM renderer; this file is the one place the whole path — the
 * click, the server action, the revalidated table, the toast's Undo — runs for real.
 *
 * ALL mutations run on the per-run CLIENT FIXTURE account ("E2E Client Co …", auth.setup.ts creates it,
 * auth.teardown.ts deletes it unconditionally) — never on `Test Client One` (CLAUDE.md hard rule; one
 * Supabase project means an e2e write to the shared seeded account is a production write).
 */
test.describe.configure({ timeout: 180_000 });

type ClientFixtureFull = { accountId: string; clerkUserId: string };
const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/**
 * Copied from contacts-drawer.spec.ts (not exported there). Read at RUN TIME, never at module scope:
 * Playwright evaluates module scope during COLLECTION, before the "setup" project has written this file,
 * so a module-scope read skips every test in this file on a fresh checkout (contacts-drawer.spec.ts
 * measured that: 21 skipped). Missing at run time is a FAILURE, not a skip — it means the "setup"
 * project's dependency was bypassed (a filtered invocation, or a bare "playwright test <file>").
 */
function fullFixture(): ClientFixtureFull {
  if (!existsSync(CLIENT_FIXTURE_FILE)) {
    throw new Error(
      `client fixture missing at ${CLIENT_FIXTURE_FILE} — the "setup" project did not run ` +
      `(a filtered invocation, or a bare "playwright test <file>", skips its dependency). ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as ClientFixtureFull;
}

const STAMP = Date.now();
const main = (page: Page) => page.locator("main");

let accountId = "";
const base = () => `/dashboard/accounts/${accountId}`;

let archiveOneId = "";
let archiveTwoId = "";

test.beforeAll(() => {
  accountId = fullFixture().accountId;
});

/**
 * Deletes both contacts with the service client — this file's own cleanup, same reasoning as
 * contacts-drawer.spec.ts's IMPORTANT CLEANUP NOTE: nothing else owns these rows, and a clean run should
 * leave none behind. Both are internal-only (no messages, calls, forms, consent, automations, bookings,
 * deals or documents), so `delete_internal_contacts` (0103) allows the service client to remove them
 * whether or not the test left one of them archived.
 */
test.afterAll(async () => {
  const svc = serviceDb();
  const ids = [archiveOneId, archiveTwoId].filter((id) => id.length > 0);
  if (ids.length === 0) return;
  const result = await deleteContacts(svc, accountId, ids, { serviceDb: svc });
  if (result.deleted !== ids.length) {
    throw new Error(
      `contacts-archive e2e cleanup: deleteContacts deleted ${result.deleted} of ${ids.length} ` +
      `(skippedBlocked ${result.skippedBlocked}, skippedFiles ${result.skippedFiles})`,
    );
  }
});

/**
 * Resolves once the archive/restore server action has been SENT and the server has ANSWERED it — the
 * same reasoning as contacts-drawer.spec.ts's `bulkDeleteAnswered` (its own doc comment: the toast comes
 * from the action's return value, but the table's re-render arrives later in the same response, and a
 * loaded CI runner can lose that race against a flat 10s wait). Copied rather than imported: that
 * function is not exported, and it answers a different pair of server actions
 * (archiveContactsAction/restoreContactsAction, not bulkDeleteContactsAction) — same shape, different name
 * so this file says what it actually waits for.
 */
function actionAnswered(page: Page, oneOfTheIds: string): Promise<void> {
  return page.waitForRequest((req) =>
    req.method() === "POST"
    && "next-action" in req.headers()
    && (req.postData() ?? "").includes(oneOfTheIds))
    .then(async (req) => {
      const res = await req.response();
      expect(res, "the archive/restore action got no response").not.toBeNull();
      expect(res!.status(), "the archive/restore action failed").toBe(200);
    });
}

/**
 * The header's real total, read off the page rather than assumed (plan Task 13: assert totals relative
 * to a total read before the action — the fixture account's contact count, active or archived, is
 * whatever earlier specs in this run left, never a literal). "{n} contacts"/"1 contact" for the list,
 * "{n} archived"/"1 archived" for the Archived view (contacts.count / contacts.archived.count,
 * messages.ts) — same pattern as documents-page.spec.ts's own `pageTotal`.
 */
async function readTotal(page: Page, view: "active" | "archived"): Promise<number> {
  const pattern = view === "archived" ? /^\d+ archived$/ : /^\d+ contacts?$/;
  const text = await main(page).getByText(pattern).first().innerText();
  const n = Number(text.match(/\d+/)?.[0]);
  if (Number.isNaN(n)) throw new Error(`readTotal: unreadable header text "${text}"`);
  return n;
}

test("archive from the list runs at once with Undo; the Archived view restores it back", async ({ page }) => {
  await page.goto(`${base()}/contacts`);

  const oneName = `Archive One ${STAMP}`;
  const twoName = `Archive Two ${STAMP}`;
  for (const [first, last] of [["Archive", `One ${STAMP}`], ["Archive", `Two ${STAMP}`]] as const) {
    await page.getByRole("button", { name: /add contact/i }).click();
    await page.getByLabel(/first name/i).fill(first);
    await page.getByLabel(/last name/i).fill(last);
    await page.getByRole("button", { name: /save|create/i }).click();
    await expect(page.getByText(`${first} ${last}`)).toBeVisible();
  }

  // Read the row ids now, while nothing hides them from the accessibility tree (contacts-drawer.spec.ts's
  // own reasoning for reading a row's id before a dialog can open) — also what afterAll cleans up even if
  // an assertion below fails first.
  const oneRow = page.getByRole("row").filter({ hasText: oneName });
  archiveOneId = (await oneRow.getAttribute("data-contact-row")) ?? "";
  expect(archiveOneId, "the Archive One row carries its contact id").toBeTruthy();
  const twoRow = page.getByRole("row").filter({ hasText: twoName });
  archiveTwoId = (await twoRow.getAttribute("data-contact-row")) ?? "";
  expect(archiveTwoId, "the Archive Two row carries its contact id").toBeTruthy();

  const bar = page.getByTestId("bulk-action-bar");

  // Archive "Archive One" — runs AT ONCE, never a confirm dialog (DESIGN.md rule 6). "Archive Two" stays
  // untouched throughout, proving the action is scoped to the selection, not the whole table.
  const beforeFirstArchive = await readTotal(page, "active");
  await oneRow.getByRole("checkbox").click();
  const firstArchive = actionAnswered(page, archiveOneId);
  await bar.getByRole("button", { name: m["bulk.archive"] }).click();
  await firstArchive;
  await expect(page.getByText(m["bulk.archivedOne"])).toBeVisible();
  await expect(page.getByText(oneName)).toHaveCount(0);
  await expect(page.getByText(twoName)).toBeVisible();
  await expect.poll(() => readTotal(page, "active")).toBe(beforeFirstArchive - 1);

  // Undo restores it — the row and the total both come back.
  const undone = actionAnswered(page, archiveOneId);
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await undone;
  await expect(page.getByText(oneName)).toBeVisible();
  await expect.poll(() => readTotal(page, "active")).toBe(beforeFirstArchive);

  // Archive it again, then follow the list's own link to the Archived view.
  const beforeSecondArchive = await readTotal(page, "active");
  await oneRow.getByRole("checkbox").click();
  const secondArchive = actionAnswered(page, archiveOneId);
  await bar.getByRole("button", { name: m["bulk.archive"] }).click();
  await secondArchive;
  await expect(page.getByText(m["bulk.archivedOne"])).toBeVisible();
  await expect.poll(() => readTotal(page, "active")).toBe(beforeSecondArchive - 1);

  await page.getByRole("link", { name: m["contacts.archived.link"], exact: true }).click();
  const archivedRow = page.getByRole("row").filter({ hasText: oneName });
  await expect(archivedRow).toBeVisible();
  // Never a literal "1 archived": another spec earlier in this run could leave its own leftover archived
  // contact here too.
  const beforeRestore = await readTotal(page, "archived");

  // Restore it from the Archived view — the same shape, its own Undo re-archiving exactly what it
  // restored (bulk-action-bar.test.ts/archive-controls.test.ts cover that side without a browser).
  await archivedRow.getByRole("checkbox").click();
  const restore = actionAnswered(page, archiveOneId);
  await bar.getByRole("button", { name: m["bulk.restore"] }).click();
  await restore;
  await expect(page.getByText(m["bulk.restoredOne"])).toBeVisible();
  await expect.poll(() => readTotal(page, "archived")).toBe(beforeRestore - 1);
  await expect(page.getByText(m["contacts.archived.emptyTitle"])).toBeVisible();

  // Back to the list.
  await page.getByRole("link", { name: m["contacts.archived.back"] }).click();
  await expect(page.getByRole("heading", { name: m["contacts.title"], exact: true })).toBeVisible();
  await expect(page.getByText(oneName)).toBeVisible();
  await expect(page.getByText(twoName)).toBeVisible();
});
