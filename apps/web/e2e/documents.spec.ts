import { test, expect, type Page, type Locator } from "./fixtures/test";
import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, createContact, DOCUMENT_BUCKET } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The document vault, PR 1a (spec 6, end to end). ON THE PER-RUN FIXTURE ACCOUNT ONLY (auth.setup.ts
 * makes it; auth.teardown.ts deletes it and, since S-07, its stored objects); never Test Client One.
 * One contact, made here with a stamped last name. afterAll reads every document this file made (by
 * the contact, trashed and half-uploaded included), removes each version's stored object by its
 * storage_path, deletes the document rows (versions cascade), then the contact, checking every error,
 * and re-reads rows AND bucket folders to confirm none is left. Test 11 deletes the contact itself
 * through the app; afterAll then finds nothing and deletes nothing.
 *
 * SERIAL on purpose: each test reads what the one before left (the files test 1 uploads are the ones
 * test 6 opens and test 7 edits; test 11 counts every file the file made). Expected files at the end,
 * all on one contact: Signed lease, Roof before (trashed by test 5), Insurance card, Permit, Bank
 * statement, ID front, Warranty, Fence = 8.
 *
 * Runs in CI's e2e job as it is: the bucket and its rows come from the in-runner stack's own
 * migrations (0077); the Staff login is auth.setup.ts's; nothing here reads local-only state.
 * Mutation probes, one per test, are in the Task 14 report and beside each test.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const STAMP = `Docs${Date.now()}`;
const ACTOR = "e2e-documents";
const STAFF_STATE = "e2e/.auth/staff-state.json";
let accountId = "";
let contactId = "";
const db = () => serviceDb();
/** Every document id this file has seen, so afterAll re-reads the bucket even for rows test 11 already purged. */
const made = { documentIds: [] as string[] };

// ---------------------------------------------------------------- copy, built from the catalogue

const fill = (s: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const filesText = (n: number) => fill(m[n === 1 ? "documents.countOne" : "documents.count"], { count: n });
const alsoFiles = (n: number) => fill(m[n === 1 ? "contacts.delete.alsoFilesOne" : "contacts.delete.alsoFiles"], { count: n });
const editName = (label: string) => new RegExp(`^${escapeRe(fill(m["inline.edit"], { label }))}: `);
const savedToast = (label: string) => fill(m["inline.saved"], { label });

// ---------------------------------------------------------------- bytes

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "binary",
);

/** A real image from the browser's own encoder (so the app's decode-and-redraw has something real to decode). */
async function canvasImage(page: Page, type: "image/jpeg" | "image/png", width: number, height: number): Promise<Buffer> {
  const b64 = await page.evaluate(async ({ type, width, height }) => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#3a6";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#a36";
    ctx.fillRect(0, 0, width / 2, height / 3);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), type, 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }, { type, width, height });
  return Buffer.from(b64, "base64");
}

/**
 * EXIF as a phone writes it, spliced in directly after SOI: IFD0 carries Orientation = 6 ("rotate 90
 * clockwise to display") and a GPSInfo pointer; the GPS IFD carries a latitude (26 deg 12' N, the
 * Valley). Big-endian TIFF. Offsets: IFD0 at 8 (2 entries -> ends at 38), GPS IFD at 38 (2 entries ->
 * ends at 68), the three latitude rationals at 68 (24 bytes) -> 92 bytes of TIFF.
 */
const GPS_IFD_TAG = Buffer.from([0x88, 0x25]);
function withExifOrientation6AndGps(jpeg: Buffer): Buffer {
  const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, ...u32(8),
    ...u16(2),
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(6), 0x00, 0x00, // Orientation (SHORT) = 6
    ...u16(0x8825), ...u16(4), ...u32(1), ...u32(38), // GPSInfo (LONG) -> 38
    ...u32(0),
    ...u16(2),
    ...u16(0x0001), ...u16(2), ...u32(2), 0x4e, 0x00, 0x00, 0x00, // GPSLatitudeRef "N"
    ...u16(0x0002), ...u16(5), ...u32(3), ...u32(68), // GPSLatitude (3 RATIONAL) -> 68
    ...u32(0),
    ...u32(26), ...u32(1), ...u32(12), ...u32(1), ...u32(0), ...u32(1),
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, ...u16(payload.length + 2)]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** Walks a JPEG's segments up to SOS: every marker seen, whether an EXIF APP1 is among them, and the frame's size. */
function jpegInfo(buf: Buffer): { soi: boolean; markers: number[]; exif: boolean; width: number; height: number } {
  const soi = buf[0] === 0xff && buf[1] === 0xd8;
  const markers: number[] = [];
  let exif = false;
  let width = 0;
  let height = 0;
  let i = 2;
  while (soi && i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1]!;
    if (marker === 0xff) { i += 1; continue; } // fill byte
    markers.push(marker);
    if (marker === 0xda || marker === 0xd9) break; // SOS: the image data starts; EOI
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.subarray(i + 4, i + 10).toString("binary") === "Exif\0\0") exif = true;
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC): precision, then height, then width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = buf.readUInt16BE(i + 5);
      width = buf.readUInt16BE(i + 7);
    }
    i += 2 + len;
  }
  return { soi, markers, exif, width, height };
}

// ---------------------------------------------------------------- the page

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const rows = (page: Page) => card(page).locator("[data-document-row]");
const rowById = (page: Page, id: string) => card(page).locator(`[data-document-row="${id}"]`);
const panel = (page: Page) => card(page).locator("[data-documents-panel]");
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;
const documentsRoute = () => `/api/accounts/${accountId}/contacts/${contactId}/documents`;
/** The browser's PUT to the signed upload URL (storage's own path; the token rides in the query). */
const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\/documents\//;

async function open(page: Page) {
  await page.goto(contactUrl());
  // Loaded, not the skeleton: the count line renders only once the card's own read has landed.
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();
}

function toast(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}
async function undoToast(page: Page, text: string) {
  await toast(page, text).getByRole("button", { name: m["common.undo"], exact: true }).click();
}
async function menu(page: Page, title: string, item: keyof typeof m) {
  await card(page).getByRole("button", { name: fill(m["documents.menu"], { title }), exact: true }).click();
  await page.getByRole("menuitem", { name: m[item], exact: true }).click();
}

// ---------------------------------------------------------------- the database (service role, fixture account only)

type StoredDoc = {
  id: string; title: string; category: string; expires_on: string | null; owners_only: boolean;
  deleted_at: string | null; source: string; current_version_id: string | null;
};
async function docsOnContact(): Promise<StoredDoc[]> {
  const { data, error } = await db().from("documents")
    .select("id, title, category, expires_on, owners_only, deleted_at, source, current_version_id")
    .eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(`documents read: ${error.message}`);
  return (data ?? []) as StoredDoc[];
}
async function docByTitle(title: string): Promise<StoredDoc> {
  const found = (await docsOnContact()).filter((d) => d.title === title);
  expect(found, `exactly one stored document titled "${title}"`).toHaveLength(1);
  return found[0]!;
}
async function storedField<K extends keyof StoredDoc>(id: string, field: K): Promise<StoredDoc[K]> {
  const { data, error } = await db().from("documents").select(field).eq("id", id).single();
  if (error) throw new Error(`documents ${field} read: ${error.message}`);
  return (data as unknown as StoredDoc)[field];
}
async function versionOf(doc: StoredDoc): Promise<{ storage_path: string; status: string; content_type: string }> {
  const { data, error } = await db().from("document_versions")
    .select("storage_path, status, content_type").eq("id", doc.current_version_id!).single();
  if (error) throw new Error(`document_versions read: ${error.message}`);
  return data as { storage_path: string; status: string; content_type: string };
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) {
    throw new Error("documents.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite: pnpm --filter web test:e2e.");
  }
  accountId = fixture.accountId;
  // The Staff login (test 4) is refused at /no-access without it; the Owner and the agency are unaffected.
  await setClientAccess(db(), accountId, true, ACTOR);
  // createContact answers an EXISTING contact on a match; anything it did not just make is someone
  // else's and afterAll must never delete it.
  const made = await createContact(db(), accountId, { firstName: "Vault", lastName: STAMP }, ACTOR);
  if (made.existing) throw new Error("documents.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
  contactId = made.id;
});

test.afterAll(async () => {
  if (!accountId || !contactId) return;
  const svc = db();
  const { data: docs, error } = await svc.from("documents").select("id").eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(`documents.spec cleanup: documents read: ${error.message}`);
  const ids = (docs ?? []).map((d: { id: string }) => d.id);
  if (ids.length > 0) {
    const { data: versions, error: vErr } = await svc.from("document_versions").select("storage_path").in("document_id", ids);
    if (vErr) throw new Error(`documents.spec cleanup: versions read: ${vErr.message}`);
    const paths = (versions ?? []).map((v: { storage_path: string }) => v.storage_path);
    if (paths.length > 0) {
      const { error: rmErr } = await svc.storage.from(DOCUMENT_BUCKET).remove(paths);
      if (rmErr) throw new Error(`documents.spec cleanup: objects remove: ${rmErr.message}`);
    }
    const { error: dErr } = await svc.from("documents").delete().in("id", ids);
    if (dErr) throw new Error(`documents.spec cleanup: documents delete: ${dErr.message}`);
  }
  const { error: cErr } = await svc.from("contacts").delete().eq("account_id", accountId).eq("id", contactId);
  if (cErr) throw new Error(`documents.spec cleanup: contact delete: ${cErr.message}`);

  // Re-read: no row, no contact, and no object under any document folder this file ever made.
  const { data: leftDocs, error: lErr } = await svc.from("documents").select("id").eq("contact_id", contactId);
  if (lErr) throw new Error(`documents.spec cleanup: re-read: ${lErr.message}`);
  expect(leftDocs ?? []).toEqual([]);
  const { data: leftContact } = await svc.from("contacts").select("id").eq("id", contactId).maybeSingle();
  expect(leftContact).toBeNull();
  for (const id of new Set([...ids, ...made.documentIds])) {
    const { data: objects, error: listErr } = await svc.storage.from(DOCUMENT_BUCKET).list(`${accountId}/${id}`);
    if (listErr) throw new Error(`documents.spec cleanup: bucket re-read ${id}: ${listErr.message}`);
    expect(objects ?? [], `no object left under ${accountId}/${id}`).toEqual([]);
  }
});

async function remember() {
  for (const d of await docsOnContact()) if (!made.documentIds.includes(d.id)) made.documentIds.push(d.id);
}

// ---------------------------------------------------------------- the tests

test("1. upload two files: progress shows, each joins the list, the count rises, the panel closes", async ({ page }) => {
  await open(page);
  await expect(card(page)).toContainText(m["documents.empty.contact"]);
  await expect(card(page).getByText(filesText(0), { exact: true })).toBeVisible();

  // Hold every PUT until the progress line has been seen: a 1 KB file otherwise uploads before any
  // assertion can look (mutation: the panel never shows a phase -> the "Uploading" line FAILS).
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(SIGNED_PUT, async (route) => {
    if (route.request().method() === "PUT") await gate;
    await route.continue();
  });

  const jpeg = withExifOrientation6AndGps(await canvasImage(page, "image/jpeg", 40, 30));
  await card(page).locator('input[type="file"][multiple]').setInputFiles([
    { name: "Signed lease.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "Roof before.jpg", mimeType: "image/jpeg", buffer: jpeg },
  ]);
  await expect(panel(page).locator("[data-panel-file]")).toHaveCount(2);
  // Rule 8: while the panel is open the header draws no Upload; the panel's own is the one primary.
  await expect(card(page).getByRole("button", { name: m["documents.upload"], exact: true })).toHaveCount(1);
  await panel(page).getByRole("button", { name: m["documents.upload"], exact: true }).click();

  const uploading = new RegExp(escapeRe(m["documents.progress.uploading"]).replace(escapeRe("{percent}"), "\\d{1,3}"));
  await expect(panel(page).getByText(uploading)).toBeVisible();
  release();

  await expect(rows(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(card(page).getByText(filesText(2), { exact: true })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(rows(page).filter({ hasText: "Roof before" })).toContainText(m["documents.category.photo"]);
  await expect(rows(page).filter({ hasText: "Signed lease" })).toContainText(m["documents.category.other"]);
  // Both stored, both ready.
  const stored = await docsOnContact();
  expect(stored.map((d) => d.title).sort()).toEqual(["Roof before", "Signed lease"]);
  for (const d of stored) expect((await versionOf(d)).status).toBe("ready");
  await remember();
});

test("2. the stored photo has no EXIF and is turned upright, and storage keeps it as private, no-store (Chromium)", async ({ page }) => {
  // Positive control on the SOURCE: the fixture really carries EXIF, a GPS pointer and a 40x30 frame.
  const source = withExifOrientation6AndGps(await canvasImage(page, "image/jpeg", 40, 30));
  const before = jpegInfo(source);
  expect(before).toMatchObject({ soi: true, exif: true, width: 40, height: 30 });
  expect(source.includes(GPS_IFD_TAG)).toBe(true);

  const photo = await docByTitle("Roof before");
  const version = await versionOf(photo);
  expect(version).toMatchObject({ status: "ready", content_type: "image/jpeg" });

  // Read it as anyone holding a signed URL would (service role mints it; fixture account only).
  const { data: signed, error } = await db().storage.from(DOCUMENT_BUCKET).createSignedUrl(version.storage_path, 60);
  if (error || !signed) throw new Error(`createSignedUrl: ${error?.message ?? "no data"}`);
  const res = await fetch(signed.signedUrl);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^image\/jpeg\b/);
  const stored = Buffer.from(await res.arrayBuffer());
  const after = jpegInfo(stored);
  expect(after.soi, "stored object is a JPEG").toBe(true);
  // Mutation: prepareFile returns the File untouched (no redraw) -> the APP1 survives -> FAILS.
  expect(after.markers, "no APP1 segment at all").not.toContain(0xe1);
  expect(after.exif).toBe(false);
  expect(stored.includes(GPS_IFD_TAG) && stored.includes(Buffer.from("Exif\0\0", "binary"))).toBe(false);
  // Orientation 6 applied: width and height swap (mutation: createImageBitmap(file, { imageOrientation: "none" }) -> 40x30 -> FAILS).
  expect({ width: after.width, height: after.height }).toEqual({ width: before.height, height: before.width });

  // LAST, so a header question can never hide the EXIF proof above. xhrPut sends cache-control
  // "private, no-store" and storage keeps it as the object's metadata. It is asserted there, not on
  // the signed GET's response: storage's signed-URL read path sends no cache-control header at all
  // (null on CI's local stack AND on hosted bis-ci, orchestrator probe 2026-10-13), even though the
  // stored value is right. info() answers storage-js 2.110.8's Camelize<FileObjectV2>, whose
  // `cache_control` arrives as `cacheControl`. Mutation: drop that header from xhrPut -> storage's
  // default "max-age=3600" -> FAILS.
  const { data: info, error: infoError } = await db().storage.from(DOCUMENT_BUCKET).info(version.storage_path);
  if (infoError || !info) throw new Error(`storage info: ${infoError?.message ?? "no data"}`);
  expect(info.cacheControl).toBe("private, no-store");
});

test("3. one failing file in a batch shows its reason and Retry; a double Retry files it exactly once", async ({ page }) => {
  await open(page);
  // The PDF's FIRST PUT fails (a dropped connection); every other PUT goes through.
  let pdfPuts = 0;
  await page.route(SIGNED_PUT, async (route) => {
    const req = route.request();
    if (req.method() === "PUT" && (await req.headerValue("content-type")) === "application/pdf") {
      pdfPuts += 1;
      if (pdfPuts === 1) { await route.abort("connectionreset"); return; }
    }
    await route.continue();
  });
  const png = await canvasImage(page, "image/png", 24, 24);
  await card(page).locator('input[type="file"][multiple]').setInputFiles([
    { name: "Insurance card.png", mimeType: "image/png", buffer: png },
    { name: "Permit.pdf", mimeType: "application/pdf", buffer: PDF },
  ]);
  await panel(page).getByRole("button", { name: m["documents.upload"], exact: true }).click();

  // The good one joined the list; the failed one stayed in the panel with its reason and Retry.
  await expect(rows(page).filter({ hasText: "Insurance card" })).toHaveCount(1, { timeout: 30_000 });
  const failed = panel(page).locator("[data-panel-file]");
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText("Permit.pdf");
  await expect(failed).toContainText(m["documents.error.upload"]);
  const retry = failed.getByRole("button", { name: m["documents.retry"], exact: true });
  await expect(retry).toBeEnabled();
  // The failed PUT's reservation was given back at once (abandon), so no "Permit" row is left.
  await expect.poll(async () => (await docsOnContact()).filter((d) => d.title === "Permit").length).toBe(0);

  // Two clicks in ONE task: React has not re-rendered between them, so the button is not yet
  // disabled and only the card's upload lock (exclusive) stands between them and a second filing.
  // Mutation: drop `exclusive` from onRetryFile (call runOne directly) -> two Permit rows -> FAILS.
  await retry.evaluate((b) => { (b as HTMLElement).click(); (b as HTMLElement).click(); });
  await expect(panel(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(rows(page).filter({ hasText: "Permit" })).toHaveCount(1);
  const permits = (await docsOnContact()).filter((d) => d.title === "Permit");
  expect(permits, "exactly ONE Permit row").toHaveLength(1);
  expect((await versionOf(permits[0]!)).status).toBe("ready");
  expect(pdfPuts, "one failed PUT and one retried PUT, never a third").toBe(2);
  await expect(card(page).getByText(filesText(4), { exact: true })).toBeVisible();
  await remember();
});

test("4. an Owners-only batch shows the lock and the word on each file, the Staff login cannot see them, and the menu's switch has an Undo", async ({ page, browser }) => {
  await open(page);
  const png = await canvasImage(page, "image/png", 24, 24);
  await card(page).locator('input[type="file"][multiple]').setInputFiles([
    { name: "Bank statement.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "ID front.png", mimeType: "image/png", buffer: png },
  ]);
  await panel(page).locator("[data-panel-owners-only]").getByRole("checkbox").click();
  await panel(page).getByRole("button", { name: m["documents.upload"], exact: true }).click();
  await expect(panel(page)).toHaveCount(0, { timeout: 30_000 });
  for (const title of ["Bank statement", "ID front"]) {
    const mark = rows(page).filter({ hasText: title }).locator("[data-owners-only]");
    // Rule 3: never colour alone. The lock (an svg) AND the word, on EACH file.
    await expect(mark).toHaveText(m["documents.ownersOnly"]);
    await expect(mark.locator("svg")).toHaveCount(1);
    expect((await docByTitle(title)).owners_only, `${title} stored Owners only`).toBe(true);
  }
  // Mutation: drop the batch's ownersOnly from uploadOne's start input -> stored false, no mark -> FAILS.
  await expect(rows(page).filter({ hasText: "Signed lease" }).locator("[data-owners-only]")).toHaveCount(0);

  // The Staff login (auth.setup.ts's per-run one, in this same org) reads the same contact.
  if (!existsSync(STAFF_STATE)) {
    throw new Error(`${STAFF_STATE} missing: "authenticate as staff user" (auth.setup.ts) did not run. Run the full suite.`);
  }
  const staffContext = await browser.newContext({ storageState: STAFF_STATE });
  try {
    const staff = await staffContext.newPage();
    await open(staff);
    // Positive control: a team file IS listed, so the session and the card are real.
    await expect(rows(staff).filter({ hasText: "Signed lease" })).toHaveCount(1);
    // Mutation: drop 0077's documents_owners_only policy -> both rows listed -> FAILS.
    await expect(rows(staff).filter({ hasText: "Bank statement" })).toHaveCount(0);
    await expect(rows(staff).filter({ hasText: "ID front" })).toHaveCount(0);
    // Signed lease, Roof before, Insurance card, Permit: the team's four, never the Owners' two.
    await expect(card(staff).getByText(filesText(4), { exact: true })).toBeVisible();
    // And the card's own read, not only the page: the titles never reach the Staff browser.
    const titles = await staff.evaluate(async (u) => {
      const r = await fetch(u, { cache: "no-store" });
      const body = (await r.json()) as { live: { title: string }[]; trashed: { title: string }[] };
      return [...body.live, ...body.trashed].map((d) => d.title);
    }, documentsRoute());
    expect(titles).not.toContain("Bank statement");
    expect(titles).not.toContain("ID front");
  } finally {
    await staffContext.close();
  }

  // The row menu's switch on an existing team file, then its Undo (compare-and-set on the server).
  const lease = await docByTitle("Signed lease");
  await menu(page, "Signed lease", "documents.makeOwnersOnly");
  await expect.poll(() => storedField(lease.id, "owners_only")).toBe(true);
  await expect(rowById(page, lease.id).locator("[data-owners-only]")).toHaveText(m["documents.ownersOnly"]);
  await undoToast(page, fill(m["documents.madeOwnersOnly"], { title: "Signed lease" }));
  await expect.poll(() => storedField(lease.id, "owners_only")).toBe(false);
  await expect(rowById(page, lease.id).locator("[data-owners-only]")).toHaveCount(0);
  await remember();
});

test("5. trash with Undo brings it back; Restore from the trash, then Undo, puts it back in the trash", async ({ page }) => {
  await open(page);
  const roof = await docByTitle("Roof before");
  const row = () => rowById(page, roof.id);
  const trash = card(page).locator("[data-documents-trash]");

  await menu(page, "Roof before", "documents.trash");
  await expect(row()).toHaveCount(0);
  await expect.poll(() => storedField(roof.id, "deleted_at")).not.toBeNull();
  // Mutation: the trash toast's Undo does nothing (drop restoreDocumentAction from offer) -> FAILS here.
  await undoToast(page, fill(m["documents.trashed"], { title: "Roof before" }));
  await expect(row()).toHaveCount(1);
  await expect.poll(() => storedField(roof.id, "deleted_at")).toBeNull();
  await expect(trash).toHaveCount(0);

  await menu(page, "Roof before", "documents.trash");
  await expect(row()).toHaveCount(0);
  await expect(trash.locator("summary")).toHaveText(fill(m["documents.trashList"], { count: 1 }));
  await trash.locator("summary").click();
  const trashed = trash.locator(`[data-document-trashed="${roof.id}"]`);
  await expect(trashed).toContainText(fill(m["documents.purgeIn"], { count: 30 }));
  await trashed.getByRole("button", { name: m["documents.restore"], exact: true }).click();
  await expect(row()).toHaveCount(1);
  await expect.poll(() => storedField(roof.id, "deleted_at")).toBeNull();

  // The Restore's own Undo trashes it again (mutation: the restore toast offers no Undo, or its Undo restores -> FAILS).
  await undoToast(page, fill(m["documents.restored"], { title: "Roof before" }));
  await expect(row()).toHaveCount(0);
  await expect(trash.locator("summary")).toHaveText(fill(m["documents.trashList"], { count: 1 }));
  await expect.poll(() => storedField(roof.id, "deleted_at")).not.toBeNull();
  // Left in the trash on purpose: test 11's file count includes trashed files.
});

test("6. the viewer opens by a click anywhere on the row and by Enter, Esc closes it, and Download goes to a signed URL", async ({ page }) => {
  await open(page);
  const viewer = page.locator("[data-document-viewer]");
  const lease = await docByTitle("Signed lease");

  // A click on the row's far left (the file icon's corner, not the title): the whole row is the target (rule 4).
  await rowById(page, lease.id).click({ position: { x: 10, y: 10 } });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading", { name: "Signed lease" })).toBeVisible();
  await expect(viewer.locator("iframe")).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/documents\/.+[?&]token=/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  const insurance = await docByTitle("Insurance card");
  const openButton = card(page).getByRole("button", { name: fill(m["documents.open"], { title: "Insurance card" }), exact: true });
  await openButton.focus();
  await expect(openButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("img")).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/documents\/.+[?&]token=/);

  const download = page.waitForEvent("download");
  await viewer.getByRole("button", { name: m["documents.download"], exact: true }).click();
  const file = await download;
  // A short-lived signed URL on THIS account's object, as an attachment named after the title.
  expect(file.url()).toMatch(new RegExp(`/storage/v1/object/sign/documents/${accountId}/${insurance.id}/[0-9a-f-]{36}\\?`));
  expect(file.url()).toMatch(/[?&]token=/);
  expect(file.suggestedFilename()).toBe("Insurance card.png");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("7. inline edits of the name, the category and the expiry each save and each Undo; an expiry 10 days out is a dot and words", async ({ page }) => {
  await open(page);
  const lease = await docByTitle("Signed lease");
  const row = rowById(page, lease.id);
  await menu(page, "Signed lease", "documents.edit");
  const edit = row.locator("[data-document-edit]");
  await expect(edit).toBeVisible();

  // Name.
  await edit.getByRole("button", { name: editName(m["documents.field.title"]) }).click();
  const name = edit.getByRole("textbox", { name: m["documents.field.title"], exact: true });
  await name.fill("Lease, signed");
  await name.press("Enter");
  await expect.poll(() => storedField(lease.id, "title")).toBe("Lease, signed");
  await expect(row).toContainText("Lease, signed");
  // Mutation: undoDocumentFieldAction writes nothing (returns ok) -> the stored title stays -> FAILS.
  await undoToast(page, savedToast(m["documents.field.title"]));
  await expect.poll(() => storedField(lease.id, "title")).toBe("Signed lease");
  await expect(row).toContainText("Signed lease");

  // Category.
  await edit.getByRole("button", { name: editName(m["documents.field.category"]) }).click();
  const category = edit.getByRole("combobox", { name: m["documents.field.category"], exact: true });
  await category.selectOption("contract");
  await category.blur();
  await expect.poll(() => storedField(lease.id, "category")).toBe("contract");
  await expect(row).toContainText(m["documents.category.contract"]);
  await undoToast(page, savedToast(m["documents.field.category"]));
  await expect.poll(() => storedField(lease.id, "category")).toBe("other");
  await expect(row).toContainText(m["documents.category.other"]);

  // Expiry, ten days after the ACCOUNT's today (the route's own `today`, never the runner's clock).
  const today = await page.evaluate(async (u) => ((await (await fetch(u, { cache: "no-store" })).json()) as { today: string }).today, documentsRoute());
  const [y, mo, d] = today.split("-").map(Number) as [number, number, number];
  const tenDays = new Date(Date.UTC(y, mo - 1, d + 10)).toISOString().slice(0, 10);
  await edit.getByRole("button", { name: editName(m["documents.field.expires"]) }).click();
  const expires = edit.locator('input[type="date"]');
  await expires.fill(tenDays);
  await expires.press("Enter");
  await expect.poll(() => storedField(lease.id, "expires_on")).toBe(tenDays);
  // Rule 3: 30 days or less is the dot AND the words (mutation: ExpiryLine drops the dot -> FAILS).
  await expect(row.locator("[data-expiry-dot]")).toHaveCount(1);
  await expect(row).toContainText(fill(m["documents.expires.in"], { count: 10 }));
  await undoToast(page, savedToast(m["documents.field.expires"]));
  await expect.poll(() => storedField(lease.id, "expires_on")).toBeNull();
  await expect(row.locator("[data-expiry-dot]")).toHaveCount(0);
});

test("8. a file dropped on the card opens the panel and uploads; the drop ring shows on drag-over and clears on drop", async ({ page }) => {
  await open(page);
  const target = card(page);
  const dataTransfer = await page.evaluateHandle(({ b64, name, type }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type }));
    return dt;
  }, { b64: PDF.toString("base64"), name: "Warranty.pdf", type: "application/pdf" });

  await expect(target).not.toHaveClass(/ring-\[3px\]/);
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await expect(target).toHaveClass(/ring-\[3px\]/);
  await target.dispatchEvent("drop", { dataTransfer });
  // Mutation: onDrop forgets setDragging(false) -> the ring stays -> FAILS.
  await expect(target).not.toHaveClass(/ring-\[3px\]/);
  await expect(panel(page).locator("[data-panel-file]")).toHaveCount(1);
  await expect(panel(page)).toContainText("Warranty.pdf");
  await panel(page).getByRole("button", { name: m["documents.upload"], exact: true }).click();
  await expect(rows(page).filter({ hasText: "Warranty" })).toHaveCount(1, { timeout: 30_000 });
  expect((await docByTitle("Warranty")).source).toBe("upload");
  await remember();
});

test("9. Take photo: hidden on a desktop; on a phone it is shown and opens the camera input (capture=environment)", async ({ page }) => {
  await open(page);
  // Desktop (Desktop Chrome: a fine pointer at 1280px): not shown, and the camera input is the only one with capture.
  await expect(card(page).locator("[data-take-photo]")).toBeHidden();
  await expect(card(page).locator('input[type="file"][capture="environment"]')).toHaveCount(1);
  await expect(card(page).locator('input[type="file"][capture="environment"]')).toHaveAttribute("accept", "image/*");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(contactUrl());
  // On a phone the card is closed until tapped (DESIGN.md: what they have, closed until tapped).
  await recordPage(page).locator('[data-record-card="documents"] h2 > button[aria-expanded]').click();
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();
  const takePhoto = card(page).locator("[data-take-photo]");
  await expect(takePhoto).toBeVisible();
  await expect(takePhoto).toHaveText(m["documents.takePhoto"]);
  const chooser = page.waitForEvent("filechooser");
  await takePhoto.click();
  const picked = await chooser;
  // Mutation: drop capture="environment" from the camera input -> FAILS.
  expect(await picked.element().getAttribute("capture")).toBe("environment");
  expect(picked.isMultiple()).toBe(false);
  await picked.setFiles({ name: "Fence.png", mimeType: "image/png", buffer: await canvasImage(page, "image/png", 24, 24) });
  await panel(page).getByRole("button", { name: m["documents.upload"], exact: true }).click();
  const fence = rows(page).filter({ hasText: "Fence" });
  await expect(fence).toHaveCount(1, { timeout: 30_000 });
  await expect(fence).toContainText(fill(m["documents.photoBy"], { name: m["documents.you"], when: "today" }));
  expect((await docByTitle("Fence")).source).toBe("camera");
  await remember();
});

test("10. the card's own read fails: its error and Retry, inside the card; the Retry loads it", async ({ page }) => {
  let refused = 0;
  await page.route(new RegExp(`${escapeRe(documentsRoute())}$`), async (route) => {
    refused += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  }, { times: 1 });
  await page.goto(contactUrl());
  const failed = card(page);
  await expect(failed).toHaveAttribute("role", "alert");
  await expect(failed).toContainText(m["documents.loadFailed"]);
  // The rest of the page still stands: one card's fault never blanks the record (DESIGN.md).
  await expect(recordPage(page).locator('[data-record-card="details"]')).toBeVisible();
  expect(refused).toBe(1);
  // Mutation: the Retry button's onClick never re-reads -> the error stays -> FAILS.
  await failed.getByRole("button", { name: m["documents.retry"], exact: true }).click();
  await expect(card(page).getByText(filesText(7), { exact: true })).toBeVisible();
  await expect(card(page)).not.toHaveAttribute("role", "alert");
});

test("11. deleting the customer from the list says how many files go, then takes the rows, the objects and records each purge", async ({ page }) => {
  // Every file this file made is on the contact, the trashed one included (test 5 left it there).
  const docs = await docsOnContact();
  expect(docs.map((d) => d.title).sort()).toEqual(
    ["Bank statement", "Fence", "ID front", "Insurance card", "Permit", "Roof before", "Signed lease", "Warranty"],
  );
  expect(docs.filter((d) => d.deleted_at !== null).map((d) => d.title)).toEqual(["Roof before"]);
  const ids = docs.map((d) => d.id);
  const { data: versions, error } = await db().from("document_versions").select("storage_path").in("document_id", ids);
  if (error) throw new Error(`versions read: ${error.message}`);
  const paths = (versions ?? []).map((v: { storage_path: string }) => v.storage_path);
  expect(paths).toHaveLength(8);

  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${encodeURIComponent(STAMP)}`);
  const row = page.locator("main").getByRole("row").filter({ hasText: STAMP });
  await expect(row).toHaveCount(1);
  await row.getByRole("checkbox").click();
  const bar = page.getByTestId("bulk-action-bar");
  await bar.getByRole("button", { name: m["bulk.delete"], exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: m["bulk.confirmTitleOne"] });
  // Mutation: countContactDocuments skips trashed files -> "7 files" -> FAILS.
  await expect(dialog.locator("[data-delete-files]")).toHaveText(alsoFiles(8));
  await dialog.getByRole("textbox").fill("1");
  await dialog.getByRole("button", { name: m["bulk.delete"], exact: true }).click();
  await expect(page.getByText(m["bulk.deletedOne"], { exact: true })).toBeVisible({ timeout: 30_000 });

  // Mutation: drop the purge from bulkDeleteContactsAction -> the contact delete fails on
  // documents_contact_fkey, the toast is not "Deleted 1 contact" and the contact stays -> FAILS.
  await expect.poll(async () => (await db().from("contacts").select("id").eq("id", contactId).maybeSingle()).data).toBeNull();
  const { data: left, error: leftErr } = await db().from("documents").select("id").in("id", ids);
  if (leftErr) throw new Error(`documents re-read: ${leftErr.message}`);
  expect(left ?? []).toEqual([]);
  // Mutation: purge the rows but not the objects -> each download still answers -> FAILS.
  for (const p of paths) {
    const { data: blob } = await db().storage.from(DOCUMENT_BUCKET).download(p);
    expect(blob, `object ${p} is gone`).toBeNull();
  }
  const { data: events, error: evErr } = await db().from("events").select("actor_type, payload")
    .eq("account_id", accountId).eq("type", "document.purged");
  if (evErr) throw new Error(`events read: ${evErr.message}`);
  const purged = (events ?? []).filter((e: { payload: { documentId?: string } }) => ids.includes(e.payload?.documentId ?? ""));
  // One per document, each the Owner's (actor "user"), each naming its contact.
  expect(purged).toHaveLength(8);
  expect(new Set(purged.map((e: { payload: { documentId: string } }) => e.payload.documentId))).toEqual(new Set(ids));
  for (const e of purged as { actor_type: string; payload: { contactId?: string } }[]) {
    expect(e.actor_type).toBe("user");
    expect(e.payload.contactId).toBe(contactId);
  }
});
