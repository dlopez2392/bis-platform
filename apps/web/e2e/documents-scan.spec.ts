import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, DOCUMENT_BUCKET } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The document vault, PR 2a (spec 7's e2e line): every file waits until clean, end to end, through
 * the REAL shim and a fake clamd that Playwright starts (playwright.config.ts; plan deviation 5).
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY, on one contact made here with a stamped last name; never Test
 * Client One. afterAll removes every object and row this file made, checking each error, and re-reads.
 * SERIAL: test 1's clean file is test 3's.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const STAMP = `DocsScan${Date.now()}`;
const ACTOR = "e2e-documents-scan";
let accountId = "";
let contactId = "";
const db = () => serviceDb();

// The EICAR test string, joined here from two halves so no file carries it whole (Global Constraints;
// same HEAD/TAIL split as services/scanner/test/eicar.mjs).
const EICAR_HEAD = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$";
const EICAR_TAIL = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const EICAR = EICAR_HEAD + EICAR_TAIL;
const pdf = (marker: string) => Buffer.from(
  `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "binary");

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const rowByTitle = (page: Page, title: string) => card(page).locator("[data-document-row]").filter({ hasText: title });
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;

async function open(page: Page) {
  await page.goto(contactUrl());
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();
}
async function upload(page: Page, name: string, buffer: Buffer) {
  await card(page).locator('input[type="file"][multiple]').setInputFiles([{ name, mimeType: "application/pdf", buffer }]);
  await card(page).locator("[data-documents-panel]").getByRole("button", { name: m["documents.upload"], exact: true }).click();
}
async function versionOf(title: string): Promise<{ docId: string; id: string; scan_status: string; storage_path: string }> {
  const { data, error } = await db().from("documents").select("id, versions:document_versions!document_versions_document_fkey(id, scan_status, storage_path)")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("title", title);
  if (error) throw new Error(`documents read: ${error.message}`);
  expect(data ?? [], `exactly one stored document titled "${title}"`).toHaveLength(1);
  const d = (data ?? [])[0] as { id: string; versions: { id: string; scan_status: string; storage_path: string }[] };
  expect(d.versions).toHaveLength(1);
  return { docId: d.id, ...d.versions[0]! };
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("documents-scan.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  const c = await createContact(db(), accountId, { firstName: "Scan", lastName: STAMP }, ACTOR);
  if (c.existing) throw new Error("documents-scan.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
  contactId = c.id;
});

test.afterAll(async () => {
  if (!accountId || !contactId) return;
  const svc = db();
  const { data: docs, error } = await svc.from("documents").select("id").eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(`cleanup: documents read: ${error.message}`);
  const ids = (docs ?? []).map((d: { id: string }) => d.id);
  if (ids.length > 0) {
    const { data: versions, error: vErr } = await svc.from("document_versions").select("storage_path").in("document_id", ids);
    if (vErr) throw new Error(`cleanup: versions read: ${vErr.message}`);
    const paths = (versions ?? []).map((v: { storage_path: string }) => v.storage_path);
    if (paths.length > 0) {
      const { error: rmErr } = await svc.storage.from(DOCUMENT_BUCKET).remove(paths);
      if (rmErr) throw new Error(`cleanup: objects remove: ${rmErr.message}`);
    }
    const { error: dErr } = await svc.from("documents").delete().in("id", ids);
    if (dErr) throw new Error(`cleanup: documents delete: ${dErr.message}`);
  }
  const { error: cErr } = await svc.from("contacts").delete().eq("account_id", accountId).eq("id", contactId);
  if (cErr) throw new Error(`cleanup: contact delete: ${cErr.message}`);
  const { data: left, error: lErr } = await svc.from("documents").select("id").eq("contact_id", contactId);
  if (lErr) throw new Error(`cleanup: re-read: ${lErr.message}`);
  expect(left ?? []).toEqual([]);
  for (const id of ids) {
    const { data: objects, error: listErr } = await svc.storage.from(DOCUMENT_BUCKET).list(`${accountId}/${id}`);
    if (listErr) throw new Error(`cleanup: bucket re-read ${id}: ${listErr.message}`);
    expect(objects ?? [], `no object left under ${accountId}/${id}`).toEqual([]);
  }
});

test("1. a clean upload is scanned at once: an ordinary row, clean in the database, and it opens (mutation: skip the finish's scan -> the row reads Checking -> FAILS)", async ({ page }) => {
  await open(page);
  await upload(page, "Insurance.pdf", pdf("clean"));
  await expect(rowByTitle(page, "Insurance")).toHaveCount(1, { timeout: 30_000 });
  await expect(rowByTitle(page, "Insurance").locator("[data-document-scan]")).toHaveCount(0);
  const v = await versionOf("Insurance");
  expect(v.scan_status).toBe("clean");
  await rowByTitle(page, "Insurance").click({ position: { x: 10, y: 10 } });
  const viewer = page.locator("[data-document-viewer]");
  await expect(viewer.locator("iframe")).toHaveAttribute("src", new RegExp(`/storage/v1/object/sign/documents/${accountId}/${v.docId}/${v.id}\\?`));
  await page.keyboard.press("Escape");
});

test("2. a file with a virus is removed at once: the row says so as a dot and a word, the object is gone, one event with ids only, and a timeline row with the automation mark (mutations: skip the object removal in scanVersion -> the object survives -> FAILS; emit the title -> FAILS)", async ({ page }) => {
  await open(page);
  await upload(page, "Lease.pdf", Buffer.concat([pdf("bad"), Buffer.from(`\n% ${EICAR}\n`)]));
  const row = rowByTitle(page, "Lease");
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row.locator('[data-document-scan="infected"]')).toHaveText(m["documents.status.virusRemoved"]);
  const v = await versionOf("Lease");
  expect(v.scan_status).toBe("infected");
  const { data: blob } = await db().storage.from(DOCUMENT_BUCKET).download(v.storage_path);
  expect(blob, "the infected object is gone").toBeNull();
  const { data: events, error } = await db().from("events").select("actor_type, payload").eq("account_id", accountId).eq("type", "document.virus_removed");
  if (error) throw new Error(`events read: ${error.message}`);
  expect((events ?? []).filter((e: { payload: { documentId?: string } }) => e.payload?.documentId === v.docId))
    .toEqual([{ actor_type: "system", payload: { documentId: v.docId, versionId: v.id } }]);
  // The viewer says why and asks for no URL (spec 3.3).
  const signs: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/object/sign/documents/")) signs.push(r.url()); });
  await row.click({ position: { x: 10, y: 10 } });
  await expect(page.locator("[data-document-viewer] [data-viewer-notice]")).toHaveText(m["documents.viewer.virusRemoved"]);
  await page.keyboard.press("Escape");
  expect(signs).toEqual([]);
  // The row menu keeps Move to trash and offers no Download.
  await card(page).getByRole("button", { name: m["documents.menu"].replace("{title}", "Lease"), exact: true }).click();
  await expect(page.getByRole("menuitem", { name: m["documents.download"], exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: m["documents.trash"], exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");
  // Assumption A10: the removed row reaches the timeline through 0079's view, with the automation mark.
  await page.reload();
  const removed = recordPage(page).locator('[data-timeline-item="documentRemoved"]');
  await expect(removed).toHaveCount(1);
  await expect(removed).toContainText(m["timeline.documentRemoved"].replace("{title}", "Lease"));
  await expect(removed).toContainText(m["provenance.automation"]);
});

/**
 * ORCHESTRATOR CHANGE TO TEST 3 (binding): the brief's original test recorded the verdict before the
 * FIRST slow re-read, which a card that re-reads only ONCE would still pass. This version adds a
 * fast-poll phase before the slow-words phase, so two separate mutations each have their own moment
 * to fail: (a) the poll effect keyed on `pollMs` alone (I1, pollTimerKey) schedules its ONE timer and
 * never another, because `pollMs` is a constant for as long as the same version stays pending — the
 * fast phase below outlasts three such intervals before the verdict ever lands, so a once-only timer
 * never re-reads again and the row never clears; (b) `settle` not bumping `reads` on every outcome has
 * the identical effect (the poll key folds `pollMs` and `reads` together; if `reads` never changes,
 * the key never changes either). Phase A: reset to pending with a FRESH created_at (young => the fast
 * 5s interval); the row must still read Checking past three such intervals (>= 16s) with no help from
 * us, then the verdict lands directly in the database (as the retry pass would) and the open card must
 * clear the row on its own, without a reload, well inside 10s. Phase B is a FRESH reset, aged past the
 * 15-minute boundary (deviation 6: age from the reservation), to prove the slow words join and the row
 * still clears on its own, bounded as the brief notes (POLL_SLOW_MS = 30s, so the last wait is <= 45s).
 */
test("3. Checking outlasts the fast poll, then clears without a reload once the verdict lands; aged, the slow words join and it clears again without a reload (mutations: the card's timer keyed on [pollMs] alone -> FAILS; settle not bumping reads -> FAILS)", async ({ page }) => {
  // Both bounded phases together run close to the describe's 90s budget; this test gets its own room.
  test.setTimeout(150_000);
  const v = await versionOf("Insurance");

  // Phase A: young (now), so the card polls on the FAST interval (5s). At least three such intervals
  // (>= 16s) with no help from us; it must STILL read Checking, not have stopped after its first timer.
  const youngReset = await db().from("document_versions").update({ scan_status: "pending", scanned_at: null, scan_attempts: 1, created_at: new Date().toISOString() }).eq("id", v.id).select("id");
  if (youngReset.error || (youngReset.data ?? []).length !== 1) throw new Error(`reset to pending (young): ${youngReset.error?.message ?? "no row"}`);
  await open(page);
  const scan = rowByTitle(page, "Insurance").locator('[data-document-scan="pending"]');
  await expect(scan).toHaveText(m["documents.status.scanning"]);
  await page.waitForTimeout(16_000);
  await expect(scan).toHaveText(m["documents.status.scanning"]);
  // The verdict lands out from under the open card (as the retry pass would record it); its own
  // polling must pick it up and clear the row on its own, with no reload, well inside the 45s bound.
  const doneFast = await db().rpc("record_document_scan", { p_account_id: accountId, p_version_id: v.id, p_verdict: "clean", p_signature: null });
  if (doneFast.error) throw new Error(`verdict (fast phase): ${doneFast.error.message}`);
  await expect(rowByTitle(page, "Insurance").locator("[data-document-scan]")).toHaveCount(0, { timeout: 10_000 });

  // Phase B: a fresh reset, aged past the 15-minute boundary, for the slow words.
  const back = await db().from("document_versions").update({ scan_status: "pending", scanned_at: null, scan_attempts: 1 }).eq("id", v.id).select("id");
  if (back.error || (back.data ?? []).length !== 1) throw new Error(`reset to pending: ${back.error?.message ?? "no row"}`);
  await open(page);
  await expect(scan).toHaveText(m["documents.status.scanning"]);
  await rowByTitle(page, "Insurance").click({ position: { x: 10, y: 10 } });
  await expect(page.locator("[data-document-viewer] [data-viewer-notice]")).toHaveText(m["documents.viewer.scanning"]);
  await page.keyboard.press("Escape");
  // Twenty minutes old: the slow words join (deviation 6: age from the reservation).
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  const aged = await db().from("document_versions").update({ created_at: old }).eq("id", v.id).select("id");
  if (aged.error) throw new Error(`age: ${aged.error.message}`);
  await page.reload();
  await expect(scan).toHaveText(`${m["documents.status.scanning"]} · ${m["documents.status.scanSlow"]}`);
  // The verdict lands elsewhere again; the open card re-reads by itself, no reload.
  const doneSlow = await db().rpc("record_document_scan", { p_account_id: accountId, p_version_id: v.id, p_verdict: "clean", p_signature: null });
  if (doneSlow.error) throw new Error(`verdict (slow phase): ${doneSlow.error.message}`);
  await expect(rowByTitle(page, "Insurance").locator("[data-document-scan]")).toHaveCount(0, { timeout: 45_000 });
});

test("4. a password-protected file is removed and its row SAYS it has a password, never the generic words (owner ruling 2026-10-15; the fake clamd answers Heuristics.Encrypted.PDF for FAKE-CLAMD-ENCRYPTED; mutation: map locked to the unscannable words -> FAILS)", async ({ page }) => {
  await open(page);
  await upload(page, "Bank.pdf", Buffer.concat([pdf("locked"), Buffer.from("\n% FAKE-CLAMD-ENCRYPTED\n")]));
  const row = rowByTitle(page, "Bank");
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row.locator('[data-document-scan="locked"]')).toHaveText(m["documents.status.passwordRemoved"]);
  await expect(row).not.toContainText(m["documents.status.unscannable"]);
  const v = await versionOf("Bank");
  expect(v.scan_status).toBe("unscannable");
  const { data: blob } = await db().storage.from(DOCUMENT_BUCKET).download(v.storage_path);
  expect(blob, "the password-protected object is gone").toBeNull();
  await row.click({ position: { x: 10, y: 10 } });
  await expect(page.locator("[data-document-viewer] [data-viewer-notice]")).toHaveText(m["documents.viewer.passwordRemoved"]);
  await page.keyboard.press("Escape");
});
