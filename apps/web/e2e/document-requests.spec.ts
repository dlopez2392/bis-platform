import { randomUUID, createHash } from "node:crypto";
import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, getBranding, brandDisplayName, createDocumentRequest, startDocumentRequestUpload,
  markDocumentVersionReady, recordDocumentScan, DOCUMENT_BUCKET, type DocumentRequestItem,
} from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";
import { requestToken, tokenHash } from "../src/lib/document-requests/token";
import { docCopy } from "../src/app/d/[token]/copy";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Document upload links (S-07 2b, task 12 brief): a customer answers a staff request with no sign-in,
 * through the REAL shim and the fake clamd (playwright.config.ts), end to end: by link, the virus path,
 * Checking turning Received without a reload, and a revoked link as a dead end. ON THE PER-RUN FIXTURE
 * ACCOUNT ONLY, on one contact made here with a stamped last name; never Test Client One. afterAll
 * removes every row and object this file made, checking each error, and re-reads.
 * SERIAL: test 1's request is test 2's; test 3's request (made directly) is test 4's.
 */
test.describe.configure({ mode: "serial", timeout: 150_000 });

const STAMP = `DocReq${Date.now()}`;
const ACTOR = "e2e-document-requests";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let accountId = "";
let contactId = "";
let business = "";
/** The request test 1 makes (channel link, items insurance + other); test 2 answers it. */
let requestId1 = "";
let requestLanguage1: "en" | "es" = "en";
/** The request test 3 seeds directly (items id + permit, so one file cannot complete it); test 4 revokes it. */
let requestId3 = "";
const db = () => serviceDb();

// The EICAR test string, joined here from two halves so no file carries it whole (Global Constraints;
// same HEAD/TAIL split as documents-scan.spec.ts and services/scanner/test/eicar.mjs).
const EICAR_HEAD = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$";
const EICAR_TAIL = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const EICAR = EICAR_HEAD + EICAR_TAIL;
const pdf = (marker: string) => Buffer.from(
  `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "binary");
const sha256Of = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;
/** A customer page's one item row (customer-upload-list.tsx), keyed by its category (the item's key). */
const docItem = (page: Page, key: string) => page.locator(`[data-docreq-item="${key}"]`);

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("document-requests.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  const c = await createContact(db(), accountId, { firstName: "Ana", lastName: STAMP }, ACTOR);
  if (c.existing) throw new Error("document-requests.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
  contactId = c.id;
  const branding = await getBranding(db(), accountId);
  business = (branding && brandDisplayName(branding)) || "";
  if (!business) throw new Error("document-requests.spec: the fixture account carries no brand name; auth.setup.ts should have set one.");
});

test.afterAll(async () => {
  if (!accountId || !contactId) return;
  const svc = db();
  const { data: docs, error } = await svc.from("documents").select("id").eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(`cleanup: documents read: ${error.message}`);
  const docIds = (docs ?? []).map((d: { id: string }) => d.id);
  if (docIds.length > 0) {
    const { data: versions, error: vErr } = await svc.from("document_versions").select("storage_path").in("document_id", docIds);
    if (vErr) throw new Error(`cleanup: versions read: ${vErr.message}`);
    const paths = (versions ?? []).map((v: { storage_path: string }) => v.storage_path);
    if (paths.length > 0) {
      const { error: rmErr } = await svc.storage.from(DOCUMENT_BUCKET).remove(paths);
      if (rmErr) throw new Error(`cleanup: objects remove: ${rmErr.message}`);
    }
  }
  const { data: reqs, error: reqErr } = await svc.from("document_requests").select("id").eq("account_id", accountId).eq("contact_id", contactId);
  if (reqErr) throw new Error(`cleanup: requests read: ${reqErr.message}`);
  const requestIds = (reqs ?? []).map((r: { id: string }) => r.id);
  if (requestIds.length > 0) {
    const { error: tErr } = await svc.from("tasks").delete().in("document_request_id", requestIds);
    if (tErr) throw new Error(`cleanup: tasks delete: ${tErr.message}`);
  }
  if (docIds.length > 0) {
    const { error: dErr } = await svc.from("documents").delete().in("id", docIds);
    if (dErr) throw new Error(`cleanup: documents delete: ${dErr.message}`);
  }
  if (requestIds.length > 0) {
    const { error: rErr } = await svc.from("document_requests").delete().in("id", requestIds);
    if (rErr) throw new Error(`cleanup: requests delete: ${rErr.message}`);
  }
  const { error: cErr } = await svc.from("contacts").delete().eq("account_id", accountId).eq("id", contactId);
  if (cErr) throw new Error(`cleanup: contact delete: ${cErr.message}`);

  const { data: leftDocs, error: ldErr } = await svc.from("documents").select("id").eq("contact_id", contactId);
  if (ldErr) throw new Error(`cleanup: re-read documents: ${ldErr.message}`);
  expect(leftDocs ?? []).toEqual([]);
  const { data: leftReqs, error: lrErr } = await svc.from("document_requests").select("id").eq("contact_id", contactId);
  if (lrErr) throw new Error(`cleanup: re-read requests: ${lrErr.message}`);
  expect(leftReqs ?? []).toEqual([]);
  if (requestIds.length > 0) {
    const { data: leftTasks, error: ltErr } = await svc.from("tasks").select("id").in("document_request_id", requestIds);
    if (ltErr) throw new Error(`cleanup: re-read tasks: ${ltErr.message}`);
    expect(leftTasks ?? []).toEqual([]);
  }
  for (const id of docIds) {
    const { data: objects, error: listErr } = await svc.storage.from(DOCUMENT_BUCKET).list(`${accountId}/${id}`);
    if (listErr) throw new Error(`cleanup: bucket re-read ${id}: ${listErr.message}`);
    expect(objects ?? [], `no object left under ${accountId}/${id}`).toEqual([]);
  }
});

test("1. staff asks, by link: the dialog, the toast, the clipboard matches requestToken(id), the card, the timeline (mutation: a wrong token derivation -> the clipboard mismatches -> FAILS)", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(contactUrl());
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();

  const ask = card(page).locator("[data-ask-customer]");
  await expect(ask).toBeVisible();
  await ask.click();

  const dialog = page.locator("[data-document-request-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-document-request-form]")).toBeVisible();
  await expect(dialog).toContainText(m["documents.request.title"].replace("{name}", `Ana ${STAMP}`));

  await dialog.getByRole("checkbox", { name: m["documents.category.insurance"], exact: true }).check();
  await dialog.getByRole("checkbox", { name: m["documents.category.other"], exact: true }).check();
  await dialog.locator("[data-request-note]").fill("Pool permit");
  await dialog.getByRole("radio", { name: m["documents.request.channel.link"], exact: true }).check();
  await dialog.getByRole("button", { name: m["documents.request.createLink"], exact: true }).click();

  await expect(page.getByText(m["documents.request.linkCopied"])).toBeVisible();
  await expect(dialog).toBeHidden();

  const { data: rows, error } = await db().from("document_requests").select("id, items, channel, language")
    .eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(`document_requests read: ${error.message}`);
  expect(rows ?? [], "exactly one document request for this contact").toHaveLength(1);
  const row = rows![0] as { id: string; items: DocumentRequestItem[]; channel: string; language: "en" | "es" };
  expect(row.channel).toBe("link");
  expect(row.items).toEqual([
    { key: "insurance", category: "insurance", note: null },
    { key: "other", category: "other", note: "Pool permit" },
  ]);
  requestId1 = row.id;
  requestLanguage1 = row.language;

  // Reading the clipboard needs focus; the toast/dialog work above can leave another tab/window
  // holding it in a headed or multi-tab run (Task 9 fix round, S-07 2b review).
  await page.bringToFront();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(`${BASE_URL}/d/${requestToken(requestId1)}`);

  const requestRow = card(page).locator(`[data-document-request="${requestId1}"]`);
  await expect(requestRow).toHaveCount(1);
  const insuranceItem = requestRow.locator('[data-request-item="insurance"]');
  await expect(insuranceItem).toContainText(m["documents.category.insurance"]);
  await expect(insuranceItem).toContainText(m["documents.requests.waiting"]);
  const otherItem = requestRow.locator('[data-request-item="other"]');
  await expect(otherItem).toContainText("Pool permit");
  await expect(otherItem).toContainText(m["documents.requests.waiting"]);
  await expect(requestRow).toContainText(m["documents.requests.expires"].replace("{count}", "7"));

  await page.reload();
  const timelineRow = recordPage(page).locator('[data-timeline-item="documentRequest"]');
  await expect(timelineRow).toHaveCount(1);
  await expect(timelineRow).toContainText(m["timeline.documentRequest"].replace("{count}", "2"));
});

test("2. the customer uploads with no sign-in: clean, the virus, clean again, then done; the database and the work queue agree (mutation: scanVersion skipping the virus check -> no refusal, no removal -> FAILS)", async ({ page, browser }) => {
  const token = requestToken(requestId1);
  const anonContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const anonPage = await anonContext.newPage();
  try {
    await anonPage.goto(`/d/${token}`);

    // The page's own helper, in the REQUEST's language (never English literally): matches what the
    // page itself renders, business name and all (Task 9 fix round, S-07 2b review).
    const tt = docCopy(requestLanguage1, business);
    await expect(anonPage.locator(".bis-docreq-title")).toHaveText(tt("customerDocs.heading"));
    await expect(anonPage.getByText(m["customerDocs.poweredBy"])).toBeVisible();
    await expect(anonPage.locator("html")).toHaveAttribute("lang", requestLanguage1);
    const cookies = await anonContext.cookies();
    expect(cookies.some((c) => /^__clerk_db_jwt/.test(c.name)), "no Clerk dev-browser cookie on the anonymous customer page").toBe(false);

    const insurance = docItem(anonPage, "insurance");
    const other = docItem(anonPage, "other");
    const fileInput = (item: ReturnType<typeof docItem>) => item.locator('input[type="file"]:not([capture])');

    await fileInput(insurance).setInputFiles({ name: "Insurance.pdf", mimeType: "application/pdf", buffer: pdf("clean-insurance") });
    await expect(insurance).toContainText(m["customerDocs.received"], { timeout: 30_000 });

    await fileInput(other).setInputFiles({ name: "bad.pdf", mimeType: "application/pdf", buffer: Buffer.concat([pdf("bad"), Buffer.from(`\n% ${EICAR}\n`)]) });
    await expect(other).toContainText(`${m["customerDocs.refused"]} · ${m["customerDocs.why.virus"]}`, { timeout: 30_000 });

    // The last clean file completes the request, and the page's re-read swaps the list for the
    // done state at once: the item's own "Received" may never paint, so the done title is the
    // proof (first CI run, 2026-10-16: the item went Checking, then the list was gone).
    await fileInput(other).setInputFiles({ name: "Other.pdf", mimeType: "application/pdf", buffer: pdf("clean-other") });

    await expect(anonPage.locator(".bis-docreq-title"))
      .toHaveText(tt("customerDocs.done"), { timeout: 30_000 });
  } finally {
    await anonContext.close();
  }

  const svc = db();
  const { data: reqRow, error: reqErr } = await svc.from("document_requests").select("completed_at")
    .eq("account_id", accountId).eq("id", requestId1).single();
  if (reqErr) throw new Error(`document_requests read: ${reqErr.message}`);
  expect((reqRow as { completed_at: string | null }).completed_at, "the request completed").not.toBeNull();

  const { data: docs, error: docsErr } = await svc.from("documents")
    .select("id, title, category, source, created_by, versions:document_versions!document_versions_document_fkey(scan_status)")
    .eq("account_id", accountId).eq("request_id", requestId1);
  if (docsErr) throw new Error(`documents read: ${docsErr.message}`);
  const list = (docs ?? []) as {
    id: string; title: string; category: string; source: string; created_by: string; versions: { scan_status: string }[];
  }[];
  expect(list, "three customer documents for this request: two clean, one removed").toHaveLength(3);
  for (const d of list) {
    expect(d.source).toBe("customer");
    expect(d.created_by).toBe(`customer:${requestId1}`);
    expect(d.versions).toHaveLength(1);
  }
  const clean = list.filter((d) => d.versions[0]!.scan_status === "clean");
  const infected = list.filter((d) => d.versions[0]!.scan_status === "infected");
  expect(clean.map((d) => d.category).sort()).toEqual(["insurance", "other"]);
  expect(infected).toHaveLength(1);
  expect(infected[0]!.category).toBe("other");

  const { data: tasks, error: tasksErr } = await svc.from("tasks").select("id, document_request_kind")
    .eq("account_id", accountId).eq("document_request_id", requestId1);
  if (tasksErr) throw new Error(`tasks read: ${tasksErr.message}`);
  expect(tasks ?? [], "exactly one task for this request").toHaveLength(1);
  expect((tasks![0] as { document_request_kind: string }).document_request_kind).toBe("received");

  await page.reload();
  const sentRows = recordPage(page).locator('[data-timeline-item="document"]');
  await expect(sentRows.filter({ hasText: m["timeline.documentCustomer"].replace("{title}", "Insurance") }), "a 'Customer sent Insurance' row")
    .not.toHaveCount(0);
  await expect(sentRows.filter({ hasText: m["timeline.documentCustomer"].replace("{title}", "Pool permit") }), "a 'Customer sent Pool permit' row")
    .not.toHaveCount(0);

  const name = `Ana ${STAMP}`;
  // The To-do's title follows the ACCOUNT's language (staff read it), never the request's own
  // (Task 9 fix round, S-07 2b review): read it back for real rather than assuming requestLanguage1.
  const { data: acctRow, error: acctErr } = await svc.from("accounts").select("language").eq("id", accountId).maybeSingle();
  if (acctErr) throw new Error(`accounts read: ${acctErr.message}`);
  const accountLanguage = (acctRow as { language: string | null } | null)?.language === "es" ? "es" : "en";
  const taskTitle = (accountLanguage === "es" ? m["documents.request.task.received.es"] : m["documents.request.task.received"]).replace("{name}", name);
  await page.goto(`/dashboard/accounts/${accountId}/tasks`);
  await expect(page.locator("main").getByText(taskTitle, { exact: true })).toBeVisible();
});

test("3. Checking outlasts the fast poll with no help from the browser, then clears without a reload once the verdict lands (mutation: the poll effect keyed on ms alone -> it never re-arms -> never clears -> FAILS)", async ({ page }) => {
  // Bumped alongside the 18s -> 22s observation window (Task 9 fix round) for the same headroom.
  test.setTimeout(75_000);
  const svc = db();
  const id = randomUUID();
  const items: DocumentRequestItem[] = [
    { key: "id", category: "id", note: null },
    { key: "permit", category: "permit", note: null },
  ];
  const now = new Date();
  await createDocumentRequest(svc, {
    id, accountId, record: { kind: "contact", id: contactId }, items, language: "en",
    tokenHash: tokenHash(requestToken(id)), channel: "link", createdBy: ACTOR, now,
  });
  requestId3 = id;

  const buf = pdf("checking-turns-received");
  const start = await startDocumentRequestUpload(svc, {
    accountId, requestId: id, itemKey: "id", bytes: buf.length, contentType: "application/pdf",
    originalName: "ID.pdf", title: "ID",
  });
  if (start.status !== "ok") throw new Error(`seed start: unexpected status ${start.status}`);
  const { error: upErr } = await svc.storage.from(DOCUMENT_BUCKET).upload(start.storagePath, buf, { contentType: "application/pdf" });
  if (upErr) throw new Error(`seed upload: ${upErr.message}`);
  const ready = await markDocumentVersionReady(svc, {
    accountId, documentId: start.documentId, versionId: start.versionId, bytes: buf.length, sha256: sha256Of(buf), actorId: ACTOR, actorType: "system",
  });
  if (!ready) throw new Error("seed: markDocumentVersionReady did not mark it ready");

  // The customer's FIRST goto: no finish ever ran, so no scan ever ran — the version is ready and
  // pending (a few seconds old). ASSERT "Checking" first, and only THEN start the clock (re-review m3).
  await page.goto(`/d/${requestToken(id)}`);
  const idItem = docItem(page, "id");
  await expect(idItem).toContainText(m["customerDocs.checking"]);

  const pageUrl = new URL(page.url());
  const reads: string[] = [];
  const onRequest = (r: { url: () => string }) => {
    if (new URL(r.url()).pathname === pageUrl.pathname) reads.push(r.url());
  };
  page.on("request", onRequest);
  // Widened from 18s to 22s (Task 9 fix round, S-07 2b review): more headroom against a slow run
  // without weakening the claim itself (still "at least 3 re-reads").
  await page.waitForTimeout(22_000);
  await expect(idItem).toContainText(m["customerDocs.checking"]);
  expect(reads.length, "at least 3 re-reads while the file is young (fast, 5s poll)").toBeGreaterThanOrEqual(3);
  page.off("request", onRequest);

  const verdict = await recordDocumentScan(svc, { accountId, versionId: start.versionId, verdict: "clean" });
  if (verdict.status !== "ok") throw new Error("verdict: the version was stale");
  // WITHOUT any reload: the open card's own polling must pick the verdict up.
  await expect(idItem).toContainText(m["customerDocs.received"], { timeout: 20_000 });
});

test("4. a revoked link is a dead end: the toast and the gone row on staff's side, the dead-end words and a 410 on the customer's (mutation: the start route skipping the revoked check -> 200 instead of 410 -> FAILS)", async ({ page, browser }) => {
  const svc = db();
  const { data: reqRow, error: reqErr } = await svc.from("document_requests").select("id, completed_at")
    .eq("account_id", accountId).eq("id", requestId3).maybeSingle();
  if (reqErr) throw new Error(`document_requests read: ${reqErr.message}`);
  let targetId = requestId3;
  if (!reqRow || (reqRow as { completed_at: string | null }).completed_at) {
    // Test 3's request completed unexpectedly (its second item was never meant to be answered): make one more.
    const freshId = randomUUID();
    await createDocumentRequest(svc, {
      id: freshId, accountId, record: { kind: "contact", id: contactId },
      items: [{ key: "contract", category: "contract", note: null }], language: "en",
      tokenHash: tokenHash(requestToken(freshId)), channel: "link", createdBy: ACTOR, now: new Date(),
    });
    targetId = freshId;
  }

  await page.goto(contactUrl());
  const requestRow = card(page).locator(`[data-document-request="${targetId}"]`);
  await expect(requestRow).toBeVisible();
  await requestRow.locator("[data-request-revoke]").click();
  await expect(page.getByText(m["documents.requests.revoked"])).toBeVisible();
  await expect(requestRow).toHaveCount(0);

  const token = requestToken(targetId);
  const anonContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`/d/${token}`);
    await expect(anonPage.locator(".bis-docreq-title")).toHaveText(m["customerDocs.revoked"]);
    await expect(anonPage.locator(".bis-docreq-detail")).toContainText(m["customerDocs.ask"].replace("{business}", business));

    const res = await anonPage.request.post(`/api/d/${token}/start`, { data: {} });
    expect(res.status()).toBe(410);
    expect(await res.json()).toEqual({ error: "revoked" });
  } finally {
    await anonContext.close();
  }
});
