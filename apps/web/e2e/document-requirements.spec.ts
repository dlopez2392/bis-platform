import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, createContact, DOCUMENT_BUCKET, getRequiredDocumentCategories, setRequiredDocumentCategories,
} from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The required-documents checklist (S-07 2c, spec 5.4, plan `2026-10-16-document-vault-pr2c.md`
 * Task 9): the meter in the Documents card's OWN top row (D9), a skip with its Undo and the timeline
 * row both moves leave, Ask from a gap ticking only that category (D2, plan review addition), an
 * upload from a gap presetting its category (plan review addition) and turning the meter Complete with
 * NO reload, and the agency-reached Settings card (D6) that sets the account's list. ON THE PER-RUN
 * FIXTURE ACCOUNT ONLY, on one contact made here with a stamped last name; never Test Client One.
 * afterAll restores the account's required list to what beforeAll read, deletes the contact's skip
 * rows, every stored object, the documents, then the contact, checking every error and re-reading that
 * none is left.
 * SERIAL: test 1 leaves Insurance and ID both required (ID re-skipped then un-skipped); test 2 skips ID
 * again and uploads Insurance, leaving the list Complete; test 3 drops ID from the list on Settings.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const STAMP = `DocReq2c${Date.now()}`;
const ACTOR = "e2e-document-requirements";
let accountId = "";
let contactId = "";
let originalRequired: string[] = [];
const db = () => serviceDb();

// The same minimal PDF builder documents-scan.spec.ts and document-requests.spec.ts use.
const pdf = (marker: string) => Buffer.from(
  `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "binary");

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const checklist = (page: Page) => card(page).locator("[data-document-checklist]");
const meter = (page: Page) => card(page).locator("[data-requirements-meter]");
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;
const category = (c: "insurance" | "id") => m[`documents.category.${c}`];

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("document-requirements.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  originalRequired = await getRequiredDocumentCategories(db(), accountId);
  await setRequiredDocumentCategories(db(), accountId, ["insurance", "id"]);
  const c = await createContact(db(), accountId, { firstName: "Lista", lastName: STAMP }, ACTOR);
  if (c.existing) throw new Error("document-requirements.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
  contactId = c.id;
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

  const { error: skipErr } = await svc.from("document_requirement_skips").delete().eq("account_id", accountId).eq("contact_id", contactId);
  if (skipErr) throw new Error(`cleanup: skips delete: ${skipErr.message}`);

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

  const { data: leftSkips, error: lsErr } = await svc.from("document_requirement_skips").select("id").eq("contact_id", contactId);
  if (lsErr) throw new Error(`cleanup: re-read skips: ${lsErr.message}`);
  expect(leftSkips ?? []).toEqual([]);
  const { data: left, error: lErr } = await svc.from("documents").select("id").eq("contact_id", contactId);
  if (lErr) throw new Error(`cleanup: re-read documents: ${lErr.message}`);
  expect(left ?? []).toEqual([]);
  for (const id of ids) {
    const { data: objects, error: listErr } = await svc.storage.from(DOCUMENT_BUCKET).list(`${accountId}/${id}`);
    if (listErr) throw new Error(`cleanup: bucket re-read ${id}: ${listErr.message}`);
    expect(objects ?? [], `no object left under ${accountId}/${id}`).toEqual([]);
  }
});

test("1. the meter in the card's top row, and a skip with its Undo leaves no row but a timeline mark, redone leaves a second row above it (mutation: the Undo action restoring the row instead of deleting it -> the re-read after Undo FAILS)", async ({ page }) => {
  await page.goto(contactUrl());
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();

  await expect(meter(page)).toContainText(m["documents.checklist.label"]);
  await expect(meter(page)).toContainText("0 of 2");
  await expect(checklist(page)).toContainText(m["documents.checklist.missing"].replace("{category}", category("insurance")));
  await expect(checklist(page)).toContainText(m["documents.checklist.missing"].replace("{category}", category("id")));

  const skipId = checklist(page).locator('[data-checklist-action="skip"][data-checklist-category="id"]');
  const skippedToast = m["documents.checklist.skipped"].replace("{category}", category("id"));
  await skipId.click();
  await expect(page.getByText(skippedToast)).toBeVisible();
  // D9: the top row redraws live, with no reload.
  await expect(meter(page)).toContainText("0 of 1");
  await expect(checklist(page)).toContainText(m["documents.checklist.notNeeded"].replace("{category}", category("id")));

  await page.getByRole("button", { name: m["common.undo"], exact: true }).click();
  await expect(meter(page)).toContainText("0 of 2");
  await expect(checklist(page)).toContainText(m["documents.checklist.missing"].replace("{category}", category("id")));
  const { data: afterUndo, error: undoErr } = await db().from("document_requirement_skips").select("id")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("category", "id");
  if (undoErr) throw new Error(`skip read after undo: ${undoErr.message}`);
  expect(afterUndo ?? [], "no skip row left for ID after its Undo").toEqual([]);

  // Keep this one: skip ID again, for real.
  await skipId.click();
  await expect(page.getByText(skippedToast)).toBeVisible();
  await expect(checklist(page)).toContainText(m["documents.checklist.notNeeded"].replace("{category}", category("id")));

  await page.goto(contactUrl());
  const skipRow = recordPage(page).locator('[data-timeline-item="documentSkip"]');
  await expect(skipRow).toHaveCount(1);
  await expect(skipRow).toContainText(m["timeline.documentSkip"].replace("{category}", category("id")));
  await expect(skipRow).toContainText(m["provenance.you"]);

  await checklist(page).locator('[data-checklist-action="unskip"][data-checklist-category="id"]').click();
  await expect(checklist(page)).toContainText(m["documents.checklist.missing"].replace("{category}", category("id")));

  await page.goto(contactUrl());
  const skipOrUnskip = recordPage(page).locator('[data-timeline-item="documentSkip"], [data-timeline-item="documentUnskip"]');
  await expect(skipOrUnskip.first()).toHaveAttribute("data-timeline-item", "documentUnskip");
  await expect(skipOrUnskip.first()).toContainText(m["timeline.documentUnskip"].replace("{category}", category("id")));
});

test("2. Ask from a gap ticks only that category while ID is still a gap too (D2), Upload from a gap presets its category, and the meter turns Complete without a reload (mutations: onAsk ticking every open item instead of just [category] -> ID is ticked too -> FAILS; the panel dropping the preset -> the category select reads the type default, not insurance -> FAILS)", async ({ page }) => {
  await page.goto(contactUrl());
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();

  // D2: with BOTH Insurance and ID still Missing, Ask the customer from the Insurance gap
  // opens the request dialog with ONLY Insurance ticked.
  await checklist(page).locator('[data-checklist-action="ask"][data-checklist-category="insurance"]').click();
  const dialog = page.locator("[data-document-request-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: category("insurance"), exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: category("id"), exact: true })).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Only Insurance stays required for the rest of this test.
  await checklist(page).locator('[data-checklist-action="skip"][data-checklist-category="id"]').click();
  await expect(page.getByText(m["documents.checklist.skipped"].replace("{category}", category("id")))).toBeVisible();
  await expect(meter(page)).toContainText("0 of 1");

  // Upload from the gap opens the upload panel with that category preset.
  const chooser = page.waitForEvent("filechooser");
  await checklist(page).locator('[data-checklist-action="upload"][data-checklist-category="insurance"]').click();
  await (await chooser).setFiles({ name: "Policy.pdf", mimeType: "application/pdf", buffer: pdf("policy") });
  const panel = card(page).locator("[data-documents-panel]");
  await expect(panel).toBeVisible();
  await expect(panel.locator("select")).toHaveValue("insurance");

  // I6: while the panel is open, the checklist offers neither Upload nor Ask the customer.
  await expect(checklist(page).locator('[data-checklist-action="upload"]')).toHaveCount(0);
  await expect(checklist(page).locator('[data-checklist-action="ask"]')).toHaveCount(0);

  await panel.getByRole("button", { name: m["documents.upload"], exact: true }).click();
  await expect(card(page).locator("[data-document-row]").filter({ hasText: "Policy" })).toHaveCount(1, { timeout: 30_000 });
  // No goto/reload since the upload: the files settle re-reads the checklist on its own.
  await expect(meter(page)).toContainText(m["documents.checklist.complete"], { timeout: 30_000 });
  await expect(checklist(page).locator('[data-checklist-item="insurance"]')).toHaveCount(0);
});

test("3. the Settings card is agency-reached (D6/A6): eight categories, no Other row, and dropping ID there removes its row from the contact's checklist with no code to change (mutation: the save keeping ID in the stored list -> the accounts re-read FAILS)", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#required-documents`);
  const main = page.locator("#required-documents");
  await expect(main.getByRole("checkbox", { name: category("insurance"), exact: true })).toBeChecked();
  await expect(main.getByRole("checkbox", { name: category("id"), exact: true })).toBeChecked();
  await expect(main.getByRole("checkbox", { name: m["documents.category.other"], exact: true })).toHaveCount(0);

  await main.getByRole("checkbox", { name: category("id"), exact: true }).uncheck();
  await main.getByRole("button", { name: m["common.save"], exact: true }).click();
  await expect(page.getByText(m["settings.requiredDocuments.saved"])).toBeVisible();

  const { data, error } = await db().from("accounts").select("required_document_categories").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`accounts read: ${error.message}`);
  expect((data as { required_document_categories: string[] } | null)?.required_document_categories).toEqual(["insurance"]);

  await page.goto(contactUrl());
  await expect(meter(page)).toContainText(m["documents.checklist.complete"]);
  await expect(checklist(page).locator('[data-checklist-item="id"]')).toHaveCount(0);
});
