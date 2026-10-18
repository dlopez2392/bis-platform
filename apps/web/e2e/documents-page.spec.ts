import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, createDocument, reserveDocumentVersion, markDocumentVersionReady, recordDocumentScan, shiftDay,
  setRequiredDocumentCategories, type DocumentCategory,
} from "@bis/db";
import { openExpiryTasks } from "../src/lib/automations/passes/documents-expiry";
import { expiryTaskTitle } from "../src/lib/documents/expiry-task";
import { m } from "../src/lib/messages";
import type { Locale } from "../src/lib/i18n/locale";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The account-wide Documents page (S-07 3a, spec 3 and 6): the page's filters and the category Select
 * (by mouse AND by keyboard), its one pager ("Next" / "Back to the start"), the Owner's Required
 * documents card with its compare-and-set Undo, and an expiry To-do opening its file with Ask the
 * customer pre-ticked. ON THE PER-RUN FIXTURE ACCOUNT ONLY, on one contact made here with a stamped
 * last name; never Test Client One. The pass runs SCOPED to this account only (openExpiryTasks(...,
 * { accountId })): an unscoped run would open To-dos on every account on the database, Test Client One
 * included. afterAll restores the account's required list, deletes every expiry To-do opened on this
 * account since this spec began (review M6: the scoped pass run may also open one for another spec's
 * file on the same account), then this spec's documents (no stored objects were made: nothing here
 * opens the viewer) and the contact, checking every error and re-reading that none is left.
 * SERIAL: one server, one shared database.
 */
test.describe.configure({ mode: "serial", timeout: 180_000 });

const STAMP = `Docs3a${Date.now()}`;
const ACTOR = "e2e-documents-page";
let accountId = "";
let contactId = "";
let contactName = "";
let originalRequired: string[] = [];
let accountLang: Locale = "en";
let today = "";
let startedAt = "";
let docA = ""; // insurance, today + 10
let docB = ""; // permit, today - 3 (already expired)
let docC = ""; // photo, no expiry
let expiresOnA = "";
const ESTIMATE_COUNT = 51;
const estimateIds: string[] = [];

const db = () => serviceDb();
const base = () => `/dashboard/accounts/${accountId}/documents`;

async function file(category: DocumentCategory, expiresOn: string | null, title: string): Promise<string> {
  const id = await createDocument(db(), {
    accountId, record: { kind: "contact", id: contactId }, title, category, expiresOn, ownersOnly: false, source: "upload", createdBy: ACTOR,
  });
  const r = await reserveDocumentVersion(db(), { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(`reserveDocumentVersion (${title}): ${r.status}`);
  const ready = await markDocumentVersionReady(db(), { accountId, documentId: id, versionId: r.versionId, bytes: 10, sha256: "a".repeat(64), actorId: ACTOR });
  if (!ready) throw new Error(`markDocumentVersionReady (${title}) did not report ready`);
  const scan = await recordDocumentScan(db(), { accountId, versionId: r.versionId, verdict: "clean" });
  if (scan.status !== "ok") throw new Error(`recordDocumentScan (${title}): ${scan.status}`);
  return id;
}

/** The header's real total — "{count} files" / "{count} file", agency session is always English here. */
async function pageTotal(page: Page): Promise<number> {
  const text = await page.getByText(/^\d+ files?$/).first().innerText();
  const n = Number(text.match(/\d+/)?.[0]);
  if (Number.isNaN(n)) throw new Error(`pageTotal: unreadable header text "${text}"`);
  return n;
}

/** Row titles that are this spec's own (STAMP-prefixed), read off each row's open button's aria-label ("Open {title}"). */
async function ourTitles(page: Page): Promise<string[]> {
  const labels = await page.locator("[data-documents-page-row] [data-document-open]").evaluateAll(
    (els) => els.map((el) => el.getAttribute("aria-label") ?? ""),
  );
  return labels.map((l) => l.replace(/^Open /, "")).filter((t) => t.startsWith(STAMP));
}

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("documents-page.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  startedAt = new Date().toISOString();

  const { data: acct, error: acctErr } = await db().from("accounts").select("required_document_categories, timezone, language")
    .eq("id", accountId).maybeSingle();
  if (acctErr) throw new Error(`account read: ${acctErr.message}`);
  const row = acct as { required_document_categories: string[]; timezone: string | null; language: Locale | null } | null;
  originalRequired = row?.required_document_categories ?? [];
  accountLang = row?.language === "es" ? "es" : "en";
  const timeZone = row?.timezone || "UTC";
  today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  const c = await createContact(db(), accountId, { firstName: "Lia", lastName: STAMP }, ACTOR);
  if (c.existing) throw new Error("documents-page.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
  contactId = c.id;
  contactName = `Lia ${STAMP}`;

  expiresOnA = shiftDay(today, 10);
  docA = await file("insurance", expiresOnA, `${STAMP} Póliza`);
  docB = await file("permit", shiftDay(today, -3), `${STAMP} Permiso`);
  docC = await file("photo", null, `${STAMP} Foto`);
  for (let i = 1; i <= ESTIMATE_COUNT; i++) {
    const id = await file("estimate", null, `${STAMP} E${String(i).padStart(2, "0")}`);
    estimateIds.push(id);
  }
});

test.afterAll(async () => {
  if (!accountId) return;
  const svc = db();
  const restored = await setRequiredDocumentCategories(svc, accountId, originalRequired);
  expect(restored).toEqual(originalRequired);
  const { data: reread, error: rereadErr } = await svc.from("accounts").select("required_document_categories").eq("id", accountId).maybeSingle();
  if (rereadErr) throw new Error(`cleanup: accounts re-read: ${rereadErr.message}`);
  expect((reread as { required_document_categories: string[] } | null)?.required_document_categories).toEqual(originalRequired);
  if (!contactId) return;

  // Every expiry To-do opened on this account since this spec began — not just this contact's (the
  // scoped pass run may have opened one for another spec's file on the same account, review M6).
  const { error: tasksErr } = await svc.from("tasks").delete()
    .eq("account_id", accountId).not("document_expiry_id", "is", null).gte("created_at", startedAt);
  if (tasksErr) throw new Error(`cleanup: expiry tasks delete: ${tasksErr.message}`);

  const { data: docs, error: docsErr } = await svc.from("documents").select("id").eq("account_id", accountId).eq("contact_id", contactId);
  if (docsErr) throw new Error(`cleanup: documents read: ${docsErr.message}`);
  const ids = (docs ?? []).map((d: { id: string }) => d.id);
  if (ids.length > 0) {
    const { error: delErr } = await svc.from("documents").delete().in("id", ids);
    if (delErr) throw new Error(`cleanup: documents delete: ${delErr.message}`);
  }
  const { error: cErr } = await svc.from("contacts").delete().eq("account_id", accountId).eq("id", contactId);
  if (cErr) throw new Error(`cleanup: contact delete: ${cErr.message}`);

  const { data: leftTasks, error: ltErr } = await svc.from("tasks").select("id")
    .eq("account_id", accountId).not("document_expiry_id", "is", null).gte("created_at", startedAt);
  if (ltErr) throw new Error(`cleanup: re-read tasks: ${ltErr.message}`);
  expect(leftTasks ?? []).toEqual([]);
  const { data: leftDocs, error: ldErr } = await svc.from("documents").select("id").eq("contact_id", contactId);
  if (ldErr) throw new Error(`cleanup: re-read documents: ${ldErr.message}`);
  expect(leftDocs ?? []).toEqual([]);
});

test("1. Filters: Expiring soon by default, Expired, and the category Select by mouse and by keyboard (mutation: arrowing inside the open Select committing instead of only Enter -> the mid-arrow URL check FAILS)", async ({ page }) => {
  await page.goto(base());
  await expect(page.locator(`[data-documents-page-row="${docA}"]`)).toBeVisible();
  await expect(page.locator(`[data-documents-page-row="${docB}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-documents-page-row="${docC}"]`)).toHaveCount(0);
  if (await page.locator("[data-documents-pager]").count() === 0) {
    expect(await pageTotal(page)).toBe(await page.locator("[data-documents-page-row]").count());
  }

  await page.getByRole("link", { name: m["documents.page.show.expired"], exact: true }).click();
  await expect(page).toHaveURL(/show=expired/);
  await expect(page.locator(`[data-documents-page-row="${docB}"]`)).toBeVisible();
  await expect(page.locator(`[data-documents-page-row="${docA}"]`)).toHaveCount(0);
  if (await page.locator("[data-documents-pager]").count() === 0) {
    expect(await pageTotal(page)).toBe(await page.locator("[data-documents-page-row]").count());
  }

  await page.goto(`${base()}?show=all&category=photo`);
  await expect(page.locator(`[data-documents-page-row="${docC}"]`)).toBeVisible();
  await expect(page.locator(`[data-documents-page-row="${docA}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-documents-page-row="${docB}"]`)).toHaveCount(0);
  if (await page.locator("[data-documents-pager]").count() === 0) {
    expect(await pageTotal(page)).toBe(await page.locator("[data-documents-page-row]").count());
  }

  // The same destination, reached through the Radix Select by KEYBOARD alone: focus the trigger, open
  // with Enter, arrow down to Photo, and only Enter commits — arrowing through the list must never
  // navigate (spec review addition).
  await page.goto(`${base()}?show=all`);
  const trigger = page.getByRole("combobox", { name: m["documents.page.category.label"] });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: m["documents.category.photo"], exact: true })).toBeVisible();
  const openedUrl = page.url();
  // any(0) -> id(1) -> contract(2) -> estimate(3) -> invoice(4) -> photo(5): five ArrowDowns.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(openedUrl);
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/category=photo/);
  await expect(page.locator(`[data-documents-page-row="${docC}"]`)).toBeVisible();
  await expect(page.locator(`[data-documents-page-row="${docA}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-documents-page-row="${docB}"]`)).toHaveCount(0);
});

test("2. Paging: exactly 50 rows, one pager, Next then Back to the start, no row lost or doubled (mutation: a page client-side re-sorting rows already in the browser instead of paging on the server -> the no-overlap check FAILS)", async ({ page }) => {
  await page.goto(`${base()}?show=all&category=estimate`);
  // The fixture account may hold another spec's estimate files too.
  const total = await pageTotal(page);
  expect(total).toBeGreaterThanOrEqual(ESTIMATE_COUNT);
  expect(total).toBeLessThanOrEqual(100);
  await expect(page.locator("[data-documents-page-row]")).toHaveCount(50);
  const pager = page.locator("[data-documents-pager]");
  await expect(pager).toHaveCount(1);
  await expect(pager.getByRole("link", { name: m["documents.page.next"], exact: true })).toBeVisible();
  await expect(pager.getByRole("link", { name: m["documents.page.first"], exact: true })).toHaveCount(0);
  const page1 = await ourTitles(page);

  await pager.getByRole("link", { name: m["documents.page.next"], exact: true }).click();
  await expect(page.locator("[data-documents-page-row]")).toHaveCount(total - 50);
  await expect(pager.getByRole("link", { name: m["documents.page.first"], exact: true })).toBeVisible();
  const page2 = await ourTitles(page);

  const overlap = page1.filter((t) => page2.includes(t));
  expect(overlap, "no title appears on both pages").toEqual([]);
  const seen = new Set([...page1, ...page2]);
  for (let i = 1; i <= ESTIMATE_COUNT; i++) {
    expect(seen.has(`${STAMP} E${String(i).padStart(2, "0")}`), `E${String(i).padStart(2, "0")} appears across the two pages`).toBe(true);
  }

  await pager.getByRole("link", { name: m["documents.page.first"], exact: true }).click();
  await expect(page.locator("[data-documents-page-row]")).toHaveCount(50);
});

test("3. The Owner card: the collapsed summary, a tick, Save with its own toast, and a compare-and-set Undo (mutation: Undo not restoring the exact prior list -> the post-Undo accounts re-read FAILS)", async ({ page }) => {
  await page.goto(base());
  const requiredCard = page.locator("[data-required-documents]");
  await requiredCard.locator("summary").click();
  await requiredCard.getByRole("checkbox", { name: m["documents.category.warranty"], exact: true }).check();
  await requiredCard.getByRole("button", { name: m["common.save"], exact: true }).click();
  await expect(page.getByText(m["settings.requiredDocuments.saved"])).toBeVisible();

  const { data: afterSave, error: saveErr } = await db().from("accounts").select("required_document_categories").eq("id", accountId).maybeSingle();
  if (saveErr) throw new Error(`accounts read after save: ${saveErr.message}`);
  expect((afterSave as { required_document_categories: string[] } | null)?.required_document_categories).toContain("warranty");

  await page.getByRole("button", { name: m["common.undo"], exact: true }).click();
  await expect(page.getByText(m["documents.required.restored"])).toBeVisible();

  const { data: afterUndo, error: undoErr } = await db().from("accounts").select("required_document_categories").eq("id", accountId).maybeSingle();
  if (undoErr) throw new Error(`accounts read after undo: ${undoErr.message}`);
  expect((afterUndo as { required_document_categories: string[] } | null)?.required_document_categories).toEqual(originalRequired);
});

test("4. An expiry To-do and its link: dedupe end to end, the work queue's title, and the card's focus with Ask the customer pre-ticked (mutation: workRowHref dropping ?ask= for a requirable category -> the dialog's Insurance checkbox assertion FAILS)", async ({ page }) => {
  const first = await openExpiryTasks(serviceDb(), new Date(), { accountId });
  expect(first.opened).toBeGreaterThanOrEqual(1);

  const { data: tasksAfterFirst, error: t1Err } = await db().from("tasks").select("id, document_expiry_on")
    .eq("account_id", accountId).eq("document_expiry_id", docA);
  if (t1Err) throw new Error(`tasks read: ${t1Err.message}`);
  expect(tasksAfterFirst ?? []).toHaveLength(1);
  expect((tasksAfterFirst as { document_expiry_on: string }[])[0].document_expiry_on).toBe(expiresOnA);

  await openExpiryTasks(serviceDb(), new Date(), { accountId });
  const { data: tasksAfterSecond, error: t2Err } = await db().from("tasks").select("id")
    .eq("account_id", accountId).eq("document_expiry_id", docA);
  if (t2Err) throw new Error(`tasks re-read: ${t2Err.message}`);
  expect(tasksAfterSecond ?? [], "the second run opens no second To-do for the same file and date").toHaveLength(1);

  await page.goto(`/dashboard/accounts/${accountId}/tasks`);
  const title = expiryTaskTitle({ category: "insurance", title: `${STAMP} Póliza`, name: contactName, expiresOn: expiresOnA }, accountLang);
  const row = page.getByRole("link", { name: title, exact: false });
  await expect(row).toBeVisible();
  await row.click();

  await expect(page).toHaveURL(new RegExp(`document=${docA}`));
  await expect(page).toHaveURL(/ask=insurance/);
  await expect(card(page).locator(`[data-document-row="${docA}"] [data-document-open]`)).toBeFocused();

  await card(page).locator("[data-ask-customer]").click();
  const dialog = page.locator("[data-document-request-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: m["documents.category.insurance"], exact: true })).toBeChecked();
});
