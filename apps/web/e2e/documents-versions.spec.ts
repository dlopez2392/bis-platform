import { test, expect, type Page } from "./fixtures/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, DOCUMENT_BUCKET, DOCUMENT_QUOTA_BYTES } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The document vault, PR 1b (spec 6's "(PR 1b)" line, end to end): a new version and "Version 2", the
 * viewer's Versions list with an older version's own download, the account's usage on the card's read,
 * and Delete forever by the typed name. ON THE PER-RUN FIXTURE ACCOUNT ONLY, on one contact made here
 * with a stamped last name; never Test Client One. afterAll reads every document this file made (by the
 * contact), removes each version's object, deletes the rows, then the contact, checking every error,
 * and re-reads rows AND bucket folders to confirm none is left.
 *
 * SERIAL: test 1 uploads the file the others use; test 4 deletes it forever.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const STAMP = `DocsV${Date.now()}`;
const ACTOR = "e2e-documents-versions";
let accountId = "";
let contactId = "";
const db = () => serviceDb();
const made: string[] = [];

const fill = (s: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A minimal valid PDF whose comment line makes each upload's bytes (and size) its own. */
const pdf = (marker: string) => Buffer.from(
  `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "binary");
const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\/documents\//;

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const rowById = (page: Page, id: string) => card(page).locator(`[data-document-row="${id}"]`);
const panel = (page: Page) => card(page).locator("[data-documents-panel]");
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;
const documentsRoute = () => `/api/accounts/${accountId}/contacts/${contactId}/documents`;
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

async function open(page: Page) {
  await page.goto(contactUrl());
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();
}
async function menu(page: Page, title: string, item: keyof typeof m) {
  await card(page).getByRole("button", { name: fill(m["documents.menu"], { title }), exact: true }).click();
  await page.getByRole("menuitem", { name: m[item], exact: true }).click();
}
async function docByTitle(title: string): Promise<{ id: string; current_version_id: string | null; deleted_at: string | null }> {
  const { data, error } = await db().from("documents").select("id, current_version_id, deleted_at")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("title", title);
  if (error) throw new Error(`documents read: ${error.message}`);
  expect(data ?? [], `exactly one stored document titled "${title}"`).toHaveLength(1);
  return (data ?? [])[0] as { id: string; current_version_id: string | null; deleted_at: string | null };
}
async function versionsOf(documentId: string): Promise<{ id: string; status: string; storage_path: string; bytes: number }[]> {
  const { data, error } = await db().from("document_versions").select("id, status, storage_path, bytes, created_at")
    .eq("document_id", documentId).order("created_at", { ascending: true });
  if (error) throw new Error(`document_versions read: ${error.message}`);
  return ((data ?? []) as { id: string; status: string; storage_path: string; bytes: number }[]).map((v) => ({ ...v, bytes: Number(v.bytes) }));
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("documents-versions.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  const c = await createContact(db(), accountId, { firstName: "Versions", lastName: STAMP }, ACTOR);
  if (c.existing) throw new Error("documents-versions.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
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
  const { data: leftDocs, error: lErr } = await svc.from("documents").select("id").eq("contact_id", contactId);
  if (lErr) throw new Error(`cleanup: re-read: ${lErr.message}`);
  expect(leftDocs ?? []).toEqual([]);
  for (const id of new Set([...ids, ...made])) {
    const { data: objects, error: listErr } = await svc.storage.from(DOCUMENT_BUCKET).list(`${accountId}/${id}`);
    if (listErr) throw new Error(`cleanup: bucket re-read ${id}: ${listErr.message}`);
    expect(objects ?? [], `no object left under ${accountId}/${id}`).toEqual([]);
  }
});

test("1. Upload new version from the row menu: progress on the row, then 'Version 2'; the new version is current and the first stays; it has its own timeline row", async ({ page }) => {
  await open(page);
  await card(page).locator('input[type="file"][multiple]').setInputFiles([{ name: "Estimate.pdf", mimeType: "application/pdf", buffer: pdf("first") }]);
  await panel(page).getByRole("button", { name: m["documents.upload"], exact: true }).click();
  await expect(card(page).locator("[data-document-row]")).toHaveCount(1, { timeout: 30_000 });
  const doc = await docByTitle("Estimate");
  made.push(doc.id);
  // One version: no label (mutation: show "Version 1" -> FAILS).
  await expect(rowById(page, doc.id).locator("[data-document-version]")).toHaveCount(0);

  // Hold the PUT until the row's progress line has been seen (mutation: never draw the phase -> FAILS).
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(SIGNED_PUT, async (route) => {
    if (route.request().method() === "PUT") await gate;
    await route.continue();
  });
  // Assumption B3: the menu item's select opens the hidden input's file chooser.
  const chooser = page.waitForEvent("filechooser");
  await menu(page, "Estimate", "documents.newVersion");
  await (await chooser).setFiles({ name: "Estimate rev.pdf", mimeType: "application/pdf", buffer: pdf("second, a longer one") });
  const uploading = new RegExp(escapeRe(m["documents.progress.uploading"]).replace(escapeRe("{percent}"), "\\d{1,3}"));
  await expect(rowById(page, doc.id).locator("[data-version-progress]")).toHaveText(uploading);
  release();

  await expect(toast(page, fill(m["documents.versionAdded"], { title: "Estimate" }))).toBeVisible({ timeout: 30_000 });
  await expect(rowById(page, doc.id).locator("[data-document-version]")).toHaveText(fill(m["documents.version"], { n: 2 }));
  await expect(rowById(page, doc.id).locator("[data-version-progress]")).toHaveCount(0);
  // Still ONE file on the card: a version is not a file (mutation: start a new document -> "2 files" -> FAILS).
  await expect(card(page).getByText(fill(m["documents.countOne"], { count: 1 }), { exact: true })).toBeVisible();
  const versions = await versionsOf(doc.id);
  expect(versions.map((v) => v.status)).toEqual(["ready", "ready"]);
  expect((await docByTitle("Estimate")).current_version_id).toBe(versions[1]!.id);
  expect(versions[1]!.bytes).toBe(pdf("second, a longer one").length);
  // Owner ruling R2: the new version is its own timeline row, with the person mark, read under RLS through
  // 0078's view (Assumption B6's PostgREST half). Mutation: drop the version read -> no row -> FAILS.
  await page.reload();
  const versionRow = recordPage(page).locator('[data-timeline-item="documentVersion"]');
  await expect(versionRow).toHaveCount(1);
  await expect(versionRow).toContainText(fill(m["timeline.documentVersion"], { title: "Estimate" }));
});

test("2. the viewer's Versions list: newest first, the current one marked, the older one downloads its OWN bytes", async ({ page }) => {
  await open(page);
  const doc = await docByTitle("Estimate");
  const [v1, v2] = await versionsOf(doc.id);
  await rowById(page, doc.id).click({ position: { x: 10, y: 10 } });
  const viewer = page.locator("[data-document-viewer]");
  const list = viewer.locator("[data-document-versions]");
  const rowsInList = list.locator("[data-document-version-row]");
  await expect(rowsInList).toHaveCount(2);
  await expect(rowsInList.first()).toHaveAttribute("data-document-version-row", v2!.id);
  await expect(list.locator(`[data-document-version-row="${v2!.id}"]`)).toContainText(m["documents.versionCurrent"]);
  await expect(list.locator(`[data-document-version-row="${v2!.id}"]`).getByRole("button")).toHaveCount(0);

  // The viewer shows the CURRENT version (v2) inline, in an iframe on a VIEW url, and headless Chromium has no
  // PDF viewer, so that load is itself a "download" event. It lands whenever the view URL's mint does, often
  // AFTER this wait is armed, and was caught instead of the button's file (CI, twice: v2's object id). The
  // button's file is minted in DOWNLOAD mode, whose signed URL alone carries `download=` (storage-js
  // createSignedUrl's `download` option), so wait for that one; the assertions below still read its path.
  const download = page.waitForEvent("download", { predicate: (d) => new URL(d.url()).searchParams.has("download") });
  await list.getByRole("button", { name: fill(m["documents.downloadVersion"], { n: 1 }), exact: true }).click();
  const file = await download;
  // A signed URL on the OLDER version's own object (mutation: download ignores the version id -> v2's path -> FAILS).
  expect(file.url()).toMatch(new RegExp(`/storage/v1/object/sign/documents/${accountId}/${doc.id}/${v1!.id}\\?`));
  expect(readFileSync((await file.path())!).toString("binary")).toContain("% first");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("3. the card's read carries the account's usage by the quota's rule; far below 80% the card draws no line", async ({ page }) => {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === documentsRoute() && r.request().method() === "GET");
  await open(page);
  const body = (await (await response).json()) as { space: { used: number; quota: number } | null };
  const doc = await docByTitle("Estimate");
  const mine = (await versionsOf(doc.id)).reduce((n, v) => n + v.bytes, 0);
  // Assumption B2 and 0078 on the CI stack: a safe integer, at least this contact's two versions (other
  // specs share the fixture account, so the exact total is not this file's to know), against 5 GB.
  expect(body.space).not.toBeNull();
  expect(Number.isSafeInteger(body.space!.used)).toBe(true);
  expect(body.space!.used).toBeGreaterThanOrEqual(mine);
  expect(body.space!.quota).toBe(DOCUMENT_QUOTA_BYTES);
  await expect(card(page).locator("[data-space-used]")).toHaveCount(0);
});

test("4. Delete forever: the trash move asks nothing; only the exact name confirms; objects, rows and one purge event", async ({ page }) => {
  await open(page);
  const doc = await docByTitle("Estimate");
  const versions = await versionsOf(doc.id);
  expect(versions).toHaveLength(2);

  await menu(page, "Estimate", "documents.trash");
  await expect(rowById(page, doc.id)).toHaveCount(0);
  await expect(toast(page, fill(m["documents.trashed"], { title: "Estimate" }))).toBeVisible();
  // Rule 6 (review I3: checked only once the move has visibly happened, so a dialog that opens late cannot
  // slip past): the move is immediate with an Undo, never a dialog (mutation: open the purge dialog on trash -> FAILS).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const trash = card(page).locator("[data-documents-trash]");
  await trash.locator("summary").click();
  await trash.locator(`[data-document-trashed="${doc.id}"]`).getByRole("button", { name: m["documents.deleteForever"], exact: true }).click();

  const dialog = page.locator("[data-document-purge-dialog]");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: m["documents.deleteForever"], exact: true });
  const box = dialog.getByRole("textbox");
  await expect(confirm).toBeDisabled();
  await box.fill("estimate");
  // Mutation: compare case-folded -> the button enables on "estimate" -> FAILS.
  await expect(confirm).toBeDisabled();
  await expect(dialog).toContainText(m["documents.purge.mismatch"]);
  await box.fill("Estimate");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(toast(page, fill(m["documents.purged"], { title: "Estimate" }))).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toHaveCount(0);
  await expect(trash).toHaveCount(0);
  // Rows gone, every version with them (mutation: delete only the current version's row -> FAILS).
  const { data: left, error } = await db().from("documents").select("id").eq("id", doc.id);
  if (error) throw new Error(`re-read: ${error.message}`);
  expect(left ?? []).toEqual([]);
  expect(await versionsOf(doc.id)).toEqual([]);
  // Objects gone, BOTH (mutation: remove only the current version's object -> the first still downloads -> FAILS).
  for (const v of versions) {
    const { data: blob } = await db().storage.from(DOCUMENT_BUCKET).download(v.storage_path);
    expect(blob, `object ${v.storage_path} is gone`).toBeNull();
  }
  // One purge event, the person's, naming the file and its customer only (mutation: emit as system -> FAILS).
  const { data: events, error: evErr } = await db().from("events").select("actor_type, payload")
    .eq("account_id", accountId).eq("type", "document.purged");
  if (evErr) throw new Error(`events read: ${evErr.message}`);
  const mine = (events ?? []).filter((e: { payload: { documentId?: string } }) => e.payload?.documentId === doc.id);
  expect(mine).toEqual([{ actor_type: "user", payload: { documentId: doc.id, contactId } }]);
});
