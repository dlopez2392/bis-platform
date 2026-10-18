import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, DOCUMENT_BUCKET } from "@bis/db";
import { tokenHash } from "../src/lib/document-requests/token";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Document vault share links (S-07 3b, task 11 brief): a clean file is shared with ONE link, opened
 * and downloaded with no sign-in in a fresh context, the first open lands exactly one timeline row
 * naming the link's recipient, Stop sharing turns the link off at once with Undo, and every refusal
 * the public route gives is the same body. ON THE PER-RUN FIXTURE ACCOUNT ONLY, on one contact made
 * here with a stamped last name; never Test Client One. afterAll removes every object and row this
 * file made, checking each error, and re-reads.
 * SERIAL: test 1's share is test 2's and test 3's; test 4 stops it; test 5 makes and stops a second one.
 */
test.describe.configure({ mode: "serial", timeout: 180_000 });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const STAMP = `Share3b${Date.now()}`;
const ACTOR = "e2e-document-shares";
let accountId = "";
let contactId = "";
let docId = "";
let lang: "en" | "es" = "en";
const db = () => serviceDb();
/** `m[key]` in English, `m[\`${key}.es\`]` in Spanish — never a hard-coded string (every word comes from `m` in the account's language). */
const tt = (key: string, params?: Record<string, string>): string => {
  const raw = (lang === "es" ? (m as Record<string, string>)[`${key}.es`] : (m as Record<string, string>)[key]) ?? "";
  return params ? Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), raw) : raw;
};

const pdf = (marker: string) => Buffer.from(
  `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "binary");

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;
const row = (page: Page) => card(page).locator(`[data-document-row="${docId}"]`);
async function openRowMenu(page: Page) {
  await row(page).getByRole("button", { name: tt("documents.menu", { title: STAMP }), exact: true }).click();
}

async function shareRow(): Promise<{
  id: string; token_hash: string; version_id: string; created_at: string; expires_at: string;
  first_opened_at: string | null; open_count: number; revoked_at: string | null;
}> {
  const { data, error } = await db().from("document_shares")
    .select("id, token_hash, version_id, created_at, expires_at, first_opened_at, open_count, revoked_at")
    .eq("account_id", accountId).eq("document_id", docId);
  if (error) throw new Error(`document_shares read: ${error.message}`);
  expect(data ?? [], "exactly one live share row for this document").toHaveLength(1);
  return data![0] as never;
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("document-shares.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  const { data: acctRow, error: acctErr } = await db().from("accounts").select("language").eq("id", accountId).maybeSingle();
  if (acctErr) throw new Error(`accounts read: ${acctErr.message}`);
  lang = (acctRow as { language: string | null } | null)?.language === "es" ? "es" : "en";
  const c = await createContact(db(), accountId, { firstName: "Lia", lastName: STAMP }, ACTOR);
  if (c.existing) throw new Error("document-shares.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
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
  if (lErr) throw new Error(`cleanup: re-read documents: ${lErr.message}`);
  expect(left ?? []).toEqual([]);
  if (ids.length > 0) {
    const { data: leftShares, error: lsErr } = await svc.from("document_shares").select("id").in("document_id", ids);
    if (lsErr) throw new Error(`cleanup: re-read shares: ${lsErr.message}`);
    expect(leftShares ?? [], "no document_shares row left for these documents").toEqual([]);
  }
  for (const id of ids) {
    const { data: objects, error: listErr } = await svc.storage.from(DOCUMENT_BUCKET).list(`${accountId}/${id}`);
    if (listErr) throw new Error(`cleanup: bucket re-read ${id}: ${listErr.message}`);
    expect(objects ?? [], `no object left under ${accountId}/${id}`).toEqual([]);
  }
});

let token = "";

test("1. Copy share link: the toast, the clipboard, the database row, the card's line, one timeline row (mutation: a wrong token derivation -> the clipboard mismatches tokenHash -> FAILS)", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(contactUrl());
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();

  await card(page).locator('input[type="file"][multiple]').setInputFiles([{ name: `${STAMP}.pdf`, mimeType: "application/pdf", buffer: pdf("clean") }]);
  await card(page).locator("[data-documents-panel]").getByRole("button", { name: m["documents.upload"], exact: true }).click();

  const uploaded = card(page).locator("[data-document-row]").filter({ hasText: STAMP });
  await expect(uploaded).toHaveCount(1, { timeout: 30_000 });
  await expect(uploaded.locator("[data-document-scan]")).toHaveCount(0, { timeout: 30_000 });
  const { data: docRows, error } = await db().from("documents").select("id, current_version_id")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("title", STAMP);
  if (error) throw new Error(`documents read: ${error.message}`);
  expect(docRows ?? [], "exactly one stored document titled the stamp").toHaveLength(1);
  docId = (docRows![0] as { id: string }).id;
  const currentVersionId = (docRows![0] as { current_version_id: string }).current_version_id;

  await openRowMenu(page);
  await page.getByRole("menuitem", { name: tt("documents.share"), exact: true }).click();

  await expect(page.getByText(tt("documents.share.copied"))).toBeVisible();

  await page.bringToFront();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(new RegExp(`^${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/s/[A-Za-z0-9_-]{43}$`));
  token = clip.slice(clip.lastIndexOf("/") + 1);

  const share = await shareRow();
  expect(share.token_hash).toBe(tokenHash(token));
  expect(share.version_id).toBe(currentVersionId);
  expect(Date.parse(share.expires_at) - Date.parse(share.created_at)).toBe(24 * 3_600_000);
  expect(share.first_opened_at).toBeNull();
  expect(share.open_count).toBe(0);
  expect(share.revoked_at).toBeNull();

  await expect(row(page).locator("[data-document-shared]")).toHaveText(tt("documents.share.live", { hours: "24" }));

  const shared = recordPage(page).locator('[data-timeline-item="documentShared"]');
  await expect(shared).toHaveCount(1);
  await expect(shared).toContainText(STAMP);
  await expect(shared).toContainText(tt("provenance.you"));
});

test("2. Open in a fresh context with no sign-in, download once, a double-click sends exactly one POST (A1, A4)", async ({ browser }) => {
  test.setTimeout(60_000);
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p = await anon.newPage();
  try {
    const posts: string[] = [];
    p.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes(`/api/s/${token}/download`)) posts.push(r.url());
    });

    const res = await p.goto(`/s/${token}`);
    expect(res).not.toBeNull();
    const headers = res!.headers();
    expect(headers["cache-control"] ?? "").toContain("no-store");
    expect(headers["referrer-policy"] ?? "").toBe("no-referrer");
    expect(headers["x-robots-tag"] ?? "").toContain("noindex");

    // The title is the page's one .bis-docreq-label line (page.test.ts pins its markup); [data-share-file] is the type/size line.
    const title = p.locator("p.bis-docreq-label");
    await expect(title).toHaveCount(1);
    await expect(title).toHaveText(STAMP);
    await expect(p.locator("[data-share-file]")).toBeVisible();
    await expect(p.locator("[data-share-download]")).toHaveCount(1);
    await expect(p.locator("main")).toHaveAttribute("lang", lang);

    // The page load counted nothing.
    let share = await shareRow();
    expect(share.first_opened_at).toBeNull();
    expect(share.open_count).toBe(0);

    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-share-download]")]);
    expect(dl.suggestedFilename()).toBe(`${STAMP}.pdf`);

    share = await shareRow();
    expect(share.first_opened_at).not.toBeNull();
    expect(share.open_count).toBe(1);
    const firstOpenedAt = share.first_opened_at;

    // A double-click on the busy button sends exactly ONE POST (the aria-disabled busy guard), but the
    // click pair that follows (busy clears, then a deliberate second press) still counts as one more
    // download and no second first_opened_at.
    posts.length = 0;
    const dblInflight = p.locator("[data-share-download]").dblclick();
    await Promise.all([p.waitForEvent("download"), dblInflight]);
    expect(posts).toHaveLength(1);
    share = await shareRow();
    expect(share.open_count).toBe(2);
    expect(share.first_opened_at).toBe(firstOpenedAt);
  } finally {
    await anon.close();
  }
});

test("3. The timeline's first-open row names the link's recipient, exactly once", async ({ page }) => {
  await page.goto(contactUrl());
  const opened = recordPage(page).locator('[data-timeline-item="documentShareOpened"]');
  await expect(opened).toHaveCount(1);
  await expect(opened).toContainText(STAMP);
  await expect(opened).toContainText(tt("provenance.linkRecipient"));
});

test("4. Stop sharing, the revoked page, uniform refusals (deviation 6)", async ({ page, browser }) => {
  await page.goto(contactUrl());
  await openRowMenu(page);
  await page.getByRole("menuitem", { name: tt("documents.share.stop"), exact: true }).click();

  await expect(page.getByText(tt("documents.share.stopped", { title: STAMP }))).toBeVisible();
  const share = await shareRow();
  expect(share.revoked_at).not.toBeNull();
  await expect(row(page).locator("[data-document-shared]")).toHaveCount(0);

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p = await anon.newPage();
  try {
    await p.goto(`/s/${token}`);
    await expect(p.locator('[data-share-state="revoked"]')).toHaveText(tt("sharePage.revoked"));
    await expect(p.locator("[data-share-download]")).toHaveCount(0);

    const revokedPost = await anon.request.post(`${BASE_URL}/api/s/${token}/download`);
    expect(revokedPost.status()).toBe(410);
    const revokedBody = await revokedPost.json();
    expect(revokedBody).toEqual({ error: "unavailable" });

    const unknownToken = "A".repeat(43);
    const unknownPost = await anon.request.post(`${BASE_URL}/api/s/${unknownToken}/download`);
    expect(unknownPost.status()).toBe(410);
    const unknownBody = await unknownPost.json();
    expect(unknownBody).toEqual(revokedBody);
  } finally {
    await anon.close();
  }
});

test("5. Undo brings a fresh stop back; a stopped link offers no Stop sharing again", async ({ page, browser }) => {
  await page.goto(contactUrl());
  await openRowMenu(page);
  await expect(page.getByRole("menuitem", { name: tt("documents.share.stop"), exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await openRowMenu(page);
  await page.getByRole("menuitem", { name: tt("documents.share"), exact: true }).click();
  await expect(page.getByText(tt("documents.share.copied"))).toBeVisible();
  await page.bringToFront();
  const secondUrl = await page.evaluate(() => navigator.clipboard.readText());
  const secondToken = secondUrl.slice(secondUrl.lastIndexOf("/") + 1);

  await openRowMenu(page);
  await page.getByRole("menuitem", { name: tt("documents.share.stop"), exact: true }).click();
  const stopToast = page.getByText(tt("documents.share.stopped", { title: STAMP }));
  await expect(stopToast).toBeVisible();

  const { data: stoppedRows, error } = await db().from("document_shares").select("id, revoked_at")
    .eq("account_id", accountId).eq("document_id", docId).eq("token_hash", tokenHash(secondToken));
  if (error) throw new Error(`document_shares read: ${error.message}`);
  expect(stoppedRows ?? [], "the second link's own row").toHaveLength(1);
  expect((stoppedRows![0] as { revoked_at: string | null }).revoked_at).not.toBeNull();

  await page.getByRole("button", { name: m["common.undo"] }).click();

  await expect.poll(async () => {
    const { data, error: readErr } = await db().from("document_shares").select("revoked_at")
      .eq("account_id", accountId).eq("id", (stoppedRows![0] as { id: string }).id).single();
    if (readErr) throw new Error(`document_shares read: ${readErr.message}`);
    return (data as { revoked_at: string | null }).revoked_at;
  }).toBeNull();

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p = await anon.newPage();
  try {
    await p.goto(`/s/${secondToken}`);
    await expect(p.locator("[data-share-download]")).toHaveCount(1);
  } finally {
    await anon.close();
  }
});
