import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createDocument, reserveDocumentVersion, markDocumentVersionReady, recordDocumentScan } from "../documents";
import { listExpiringDocuments, listDocumentExpiryTaskKeys, ensureDocumentExpiryTask, expiryTaskKey, deleteOpenExpiryTasks } from "../document-expiry";
import { shiftDay, DOCUMENT_EXPIRY_WINDOW_DAYS } from "../document-rules";

/** The pass's reads and its one write (spec 3.2), on the service client, behind PostgREST on the replica. */
const ACTOR = "user_dex_test";
type FileOpts = { expiresOn: string | null; ownersOnly?: boolean; verdict?: "clean" | "pending"; trashed?: boolean; category?: "insurance" | "other" };

async function file(db: SupabaseClient, accountId: string, contactId: string, o: FileOpts): Promise<string> {
  const id = await createDocument(db, {
    accountId, record: { kind: "contact", id: contactId }, title: "Seguro", category: o.category ?? "insurance",
    expiresOn: o.expiresOn, ownersOnly: o.ownersOnly ?? false, source: "upload", createdBy: ACTOR,
  });
  const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(r.status);
  expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: 10, sha256: "a".repeat(64), actorId: ACTOR })).toBe(true);
  if ((o.verdict ?? "clean") === "clean") await recordDocumentScan(db, { accountId, versionId: r.versionId, verdict: "clean" });
  if (o.trashed) {
    const { error } = await db.from("documents").update({ deleted_at: new Date().toISOString(), deleted_by: ACTOR }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  return id;
}
const FROM = "2030-03-01";
const TO = shiftDay(FROM, DOCUMENT_EXPIRY_WINDOW_DAYS);

describe("document-rules: shiftDay", () => {
  it("is calendar arithmetic across a month and a leap day (mutation: add 86_400_000 ms per day in local time -> FAILS on a DST-zone runner; drop the padding -> FAILS)", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2026-10-17", 30)).toBe("2026-11-16");
    expect(shiftDay("2026-11-16", -7)).toBe("2026-11-09");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("listExpiringDocuments (spec 3.2: who qualifies)", () => {
  it("answers a live, not Owners-only, clean file in the range, with its account's zone and language; never one trashed, Owners only, still being checked or outside the range (mutations: drop .is('deleted_at', null), .eq('owners_only', false), the !inner scan filter, or either bound -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ok = await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 10) });
      const edgeLow = await file(db, accountId, ana, { expiresOn: FROM });
      const edgeHigh = await file(db, accountId, ana, { expiresOn: TO });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, -1) });
      await file(db, accountId, ana, { expiresOn: shiftDay(TO, 1) });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 5), ownersOnly: true });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 5), trashed: true });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 5), verdict: "pending" });
      await file(db, accountId, ana, { expiresOn: null });
      const rows = await listExpiringDocuments(db, { fromDay: FROM, toDay: TO, limit: 50, accountId });
      expect(rows.map((r) => r.id).sort()).toEqual([ok, edgeLow, edgeHigh].sort());
      const row = rows.find((r) => r.id === ok)!;
      expect(row).toMatchObject({ account_id: accountId, contact_id: ana, client_group_id: null, category: "insurance", expires_on: shiftDay(FROM, 10), owners_only: false, deleted_at: null, version_scan: "clean", account_timezone: "America/Chicago" });
      expect(rows.map((r) => r.expires_on)).toEqual([...rows.map((r) => r.expires_on)].sort().reverse());
    }));

  it("spends the limit on clean files only, so a file still being checked never crowds one out of the capped read (mutation: drop !inner -> the pending row takes the one slot and is then dropped -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const clean = await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 10) });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 20), verdict: "pending" });
      const rows = await listExpiringDocuments(db, { fromDay: FROM, toDay: TO, limit: 1, accountId });
      expect(rows.map((r) => r.id)).toEqual([clean]);
    }));

  it("is scoped to one account when asked (mutation: ignore accountId -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await withTestAccount(async (dbB, accountB) => {
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        const theirs = await file(dbB, accountB, bea, { expiresOn: shiftDay(FROM, 3) });
        const rows = await listExpiringDocuments(db, { fromDay: FROM, toDay: TO, limit: 50, accountId });
        expect(rows.map((r) => r.id)).not.toContain(theirs);
        const all = await listExpiringDocuments(db, { fromDay: FROM, toDay: TO, limit: 1000 });
        expect(all.map((r) => r.id)).toContain(theirs);
      });
    }));
});

describe("ensureDocumentExpiryTask and listDocumentExpiryTaskKeys (spec 3.2: exactly one per document and date)", () => {
  it("opens one To-do with both links and one task.created event; a second call finds it; a new date opens a second (mutations: no 23505 path -> the second call THROWS; emit on the found path -> two events -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const doc = await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 10) });
      const input = { documentId: doc, expiresOn: shiftDay(FROM, 10), contactId: ana, title: "Ana's insurance expires on Mar 11", dueAt: "2030-03-04T15:00:00.000Z" };
      const a = await ensureDocumentExpiryTask(db, accountId, input, "documents-expiry", "system");
      const b = await ensureDocumentExpiryTask(db, accountId, input, "documents-expiry", "system");
      expect(a.created).toBe(true);
      expect(b).toEqual({ id: a.id, created: false });
      const { data: t } = await db.from("tasks").select("contact_id, title, due_at, document_expiry_id, document_expiry_on").eq("id", a.id).single();
      expect(t).toMatchObject({ contact_id: ana, title: input.title, document_expiry_id: doc, document_expiry_on: input.expiresOn });
      expect(Date.parse((t as { due_at: string }).due_at)).toBe(Date.parse(input.dueAt));
      const { data: ev } = await db.from("events").select("actor_type, actor_id, payload").eq("account_id", accountId).eq("type", "task.created");
      expect(ev).toEqual([{ actor_type: "system", actor_id: "documents-expiry", payload: { taskId: a.id, contactId: ana, documentId: doc } }]);
      const c = await ensureDocumentExpiryTask(db, accountId, { ...input, expiresOn: shiftDay(FROM, 20) }, "documents-expiry", "system");
      expect(c.created).toBe(true);
      expect(c.id).not.toBe(a.id);
      const keys = await listDocumentExpiryTaskKeys(db, [doc]);
      expect([...keys].sort()).toEqual([expiryTaskKey(doc, shiftDay(FROM, 10)), expiryTaskKey(doc, shiftDay(FROM, 20))].sort());
      expect(await listDocumentExpiryTaskKeys(db, [])).toEqual(new Set());
    }));
});

describe("deleteOpenExpiryTasks (owner ruling R1: a file made Owners only takes its open expiry To-dos with it)", () => {
  it("deletes this account's OPEN To-dos for this file only; a done one, another file's and another account's stay (mutations: drop .is('completed_at', null), the account eq, or the document eq -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await withTestAccount(async (dbB, accountB) => {
        const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
        const doc = await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 10) });
        const other = await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 12) });
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        const theirs = await file(dbB, accountB, bea, { expiresOn: shiftDay(FROM, 10) });
        const t = (documentId: string, acct: string, on: string, contactId: string) =>
          ensureDocumentExpiryTask(db, acct, { documentId, expiresOn: on, contactId, title: "T", dueAt: "2030-03-01T15:00:00Z" }, "documents-expiry");
        const open = await t(doc, accountId, shiftDay(FROM, 10), ana);
        const done = await t(doc, accountId, shiftDay(FROM, 11), ana);
        await db.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", done.id);
        const otherOpen = await t(other, accountId, shiftDay(FROM, 12), ana);
        const theirOpen = await t(theirs, accountB, shiftDay(FROM, 10), bea);
        expect(await deleteOpenExpiryTasks(db, accountB, doc)).toBe(0);
        expect(await deleteOpenExpiryTasks(db, accountId, doc)).toBe(1);
        const { data } = await db.from("tasks").select("id").in("id", [open.id, done.id, otherOpen.id, theirOpen.id]);
        expect((data ?? []).map((r: { id: string }) => r.id).sort()).toEqual([done.id, otherOpen.id, theirOpen.id].sort());
      });
    }));
});
