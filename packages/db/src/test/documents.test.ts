import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember } from "../client-groups";
import {
  createDocument, reserveDocumentVersion, markDocumentVersionReady, discardDocumentUpload, listRecordDocuments,
  getDocument, updateDocumentField, setDocumentOwnersOnly, trashDocument, restoreDocument, listAbandonedUploads,
  listPurgeableDocuments, purgeDocumentRow, deleteAbandonedVersion, listDocumentTimeline,
  countContactDocuments, purgeContactDocuments, MAX_DOCUMENTS_READ,
  documentSpaceUsed, listDocumentVersionStates, claimDocumentForPurge, deletePurgedDocument, listDocumentVersionTimeline,
  DOCUMENT_PURGING_MARK,
  signedDocumentReadUrl, signedScannerUrl, recordDocumentScan, listPendingScans, oldestPendingScanAt, listDocumentScanTimeline,
} from "../documents";
import { removedReason } from "../document-rules";

/**
 * The document vault's data layer (spec sections 3 and 5), on the service client a server action
 * holds AFTER its request-client proof. RLS itself is document-vault-rls.test.ts's job.
 */
const ACTOR = "user_docs_test";
const HASH = "b".repeat(64);
/** The size every helper reserves AND finishes at: 0077's mark_document_version_ready refuses any other (size_mismatch). */
const BYTES = 100;

async function readyDoc(db: SupabaseClient, accountId: string, contactId: string, over: Partial<{ title: string }> = {}) {
  const id = await createDocument(db, {
    accountId, record: { kind: "contact", id: contactId }, title: over.title ?? "Contract", category: "contract",
    expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR,
  });
  const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: BYTES, contentType: "application/pdf", originalName: "c.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(`reserve: ${r.status}`);
  expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: BYTES, sha256: HASH, actorId: ACTOR })).toBe(true);
  return { id, versionId: r.versionId, path: r.storagePath };
}

const events = async (db: SupabaseClient, accountId: string, type: string) => {
  const { data, error } = await db.from("events").select("actor_type, actor_id, payload").eq("account_id", accountId).eq("type", type);
  if (error) throw error;
  return data ?? [];
};

describe("an upload's life (spec 5.1)", () => {
  it("listed only once ready, at its reserved size; document.added once, with no title (mutation: put the title in document.added's payload -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const pending = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Pending", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      await reserveDocumentVersion(db, { accountId, documentId: pending, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      const d = await readyDoc(db, accountId, ana);
      const list = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect(list.live.map((x) => x.id)).toEqual([d.id]);
      expect(list.live[0]!.version).toMatchObject({ id: d.versionId, bytes: BYTES, status: "ready", content_type: "application/pdf" });
      expect(await events(db, accountId, "document.added")).toEqual([
        { actor_type: "user", actor_id: ACTOR, payload: { documentId: d.id, contactId: ana } }]);
    }));

  it("a never-ready document never takes a listed one's place under the read cap (mutation: drop the current_version_id filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      // MAX_DOCUMENTS_READ + 1 never-ready documents, all NEWER than the ready one: without the filter the
      // capped read returns only them, and the ready document falls off the card.
      const { error } = await db.from("documents").insert(Array.from({ length: MAX_DOCUMENTS_READ + 1 }, (_, n) => ({
        account_id: accountId, contact_id: ana, title: `Pending ${n}`, category: "other", source: "upload",
        scan_status: "skipped", created_by: ACTOR,
      })));
      if (error) throw error;
      const list = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect([list.live.map((x) => x.id), list.liveMore]).toEqual([[d.id], false]);
    }));

  it("a finish at any size but the reserved one is refused: not ready, not listed, no event (mutation: return false only for not_found -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Odd size", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: BYTES, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: BYTES + 1, sha256: HASH, actorId: ACTOR })).toBe(false);
      expect((await listRecordDocuments(db, accountId, { kind: "contact", id: ana })).live).toEqual([]);
      expect(await events(db, accountId, "document.added")).toEqual([]);
    }));

  it("a ready upload is reported ready even when the read for its event fails (mutation: the document read outside the best-effort path -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Read fails", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: BYTES, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      // The real client, except that a read of `documents` fails: the rpc (the write) stays real.
      const failing: { maybeSingle: () => Promise<unknown> } & Record<string, unknown> = {
        maybeSingle: async () => ({ data: null, error: { message: "read down" } }),
      };
      failing.select = () => failing; failing.eq = () => failing;
      const flaky = new Proxy(db, { get: (t, p) => (p === "from" ? (table: string) => (table === "documents" ? failing : t.from(table)) : Reflect.get(t, p, t)) }) as SupabaseClient;
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(await markDocumentVersionReady(flaky, { accountId, documentId: id, versionId: r.versionId, bytes: BYTES, sha256: HASH, actorId: ACTOR })).toBe(true);
        expect(errors.mock.calls.some(([msg]) => String(msg).includes("document.added") && String(msg).includes("read down"))).toBe(true);
      } finally {
        errors.mockRestore();
      }
      expect((await listRecordDocuments(db, accountId, { kind: "contact", id: ana })).live.map((x) => x.id)).toEqual([id]);
    }));

  it("a second finish is refused: only an uploading version becomes ready (mutation: drop `and status = 'uploading'` from mark_document_version_ready -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      // The reserved size, so only the status can refuse it.
      expect(await markDocumentVersionReady(db, { accountId, documentId: d.id, versionId: d.versionId, bytes: BYTES, sha256: HASH, actorId: ACTOR })).toBe(false);
      expect(await events(db, accountId, "document.added")).toHaveLength(1);
    }));

  it("discarding a failed first upload removes version and document; never a ready document (mutation: drop .is('current_version_id', null) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Bad", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      await discardDocumentUpload(db, accountId, id, r.versionId);
      expect(await getDocument(db, accountId, id)).toBeNull();
      const d = await readyDoc(db, accountId, ana);
      await discardDocumentUpload(db, accountId, d.id, d.versionId);
      expect(await getDocument(db, accountId, d.id)).not.toBeNull();
    }));
});

describe("edits, trash and restore are compare-and-set (spec 4.1, 4.4)", () => {
  it("an Undo whose expected value no longer holds changes nothing (mutation: drop the expected-value filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      expect(await updateDocumentField(db, accountId, d.id, "title", "Signed contract")).toBe("updated");
      expect(await updateDocumentField(db, accountId, d.id, "title", "Third")).toBe("updated");
      expect(await updateDocumentField(db, accountId, d.id, "title", "Contract", { value: "Signed contract" })).toBe("changed");
      expect((await getDocument(db, accountId, d.id))!.title).toBe("Third");
      expect(await updateDocumentField(db, accountId, d.id, "expires_on", "2026-12-01", { value: null })).toBe("updated");
      expect(await setDocumentOwnersOnly(db, accountId, d.id, true, false)).toBe("updated");
      expect(await setDocumentOwnersOnly(db, accountId, d.id, false, false)).toBe("changed");
    }));

  it("trash answers the stored instant; restore only while it still holds; both emit; a trashed file refuses edits (mutation: restore without .eq('deleted_at', expected) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const t1 = await trashDocument(db, accountId, d.id, ACTOR);
      if (t1.status !== "trashed") throw new Error("not trashed");
      expect(await trashDocument(db, accountId, d.id, ACTOR)).toEqual({ status: "changed" });
      const list = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect([list.live.length, list.trashed.map((x) => x.id)]).toEqual([0, [d.id]]);
      expect(await restoreDocument(db, accountId, d.id, "2000-01-01T00:00:00+00:00", ACTOR)).toBe("changed");
      expect(await restoreDocument(db, accountId, d.id, t1.deletedAt, ACTOR)).toBe("updated");
      expect(await events(db, accountId, "document.trashed")).toHaveLength(1);
      expect(await events(db, accountId, "document.restored")).toHaveLength(1);
      await trashDocument(db, accountId, d.id, ACTOR);
      expect(await updateDocumentField(db, accountId, d.id, "title", "X")).toBe("changed");
    }));

  it("trash and restore events carry the document and its record only, never its title or category (mutation: category in the trashed or restored payload -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const t1 = await trashDocument(db, accountId, d.id, ACTOR);
      if (t1.status !== "trashed") throw new Error("not trashed");
      expect(await restoreDocument(db, accountId, d.id, t1.deletedAt, ACTOR)).toBe("updated");
      const row = { actor_type: "user", actor_id: ACTOR, payload: { documentId: d.id, contactId: ana } };
      expect(await events(db, accountId, "document.trashed")).toEqual([row]);
      expect(await events(db, accountId, "document.restored")).toEqual([row]);
    }));

  it("Owners only on a trashed file changes nothing (mutation: drop .is('deleted_at', null) in setDocumentOwnersOnly -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      await trashDocument(db, accountId, d.id, ACTOR);
      expect(await setDocumentOwnersOnly(db, accountId, d.id, true)).toBe("changed");
      expect((await getDocument(db, accountId, d.id))!.owners_only).toBe(false);
    }));
});

describe("the sweep's reads (spec 5.4)", () => {
  it("purgeable = trashed before the cutoff, with every path; purge emits as the system (mutation: .lt -> .gt on deleted_at -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const old = await readyDoc(db, accountId, ana, { title: "Old" });
      const fresh = await readyDoc(db, accountId, ana, { title: "Fresh" });
      const { error } = await db.from("documents").update({ deleted_at: "2026-01-01T00:00:00Z", deleted_by: ACTOR }).eq("id", old.id);
      if (error) throw error;
      await trashDocument(db, accountId, fresh.id, ACTOR);
      const due = (await listPurgeableDocuments(db, "2026-02-01T00:00:00Z", 50)).filter((x) => x.account_id === accountId);
      expect(due.map((x) => [x.id, x.paths])).toEqual([[old.id, [old.path]]]);
      expect(await purgeDocumentRow(db, due[0]!)).toBe(true);
      expect(await getDocument(db, accountId, old.id)).toBeNull();
      expect(await events(db, accountId, "document.purged")).toEqual([
        { actor_type: "system", actor_id: "documents-sweep", payload: { documentId: old.id, contactId: ana } }]);
    }));

  it("abandoned = still uploading before the cutoff; deleting one takes a never-ready document too (mutation: drop the document delete in discardDocumentUpload -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Stuck", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      const future = new Date(Date.now() + 60_000).toISOString();
      const stuck = (await listAbandonedUploads(db, future, 500)).filter((v) => v.account_id === accountId);
      expect(stuck.map((v) => v.document_id)).toEqual([id]);
      await deleteAbandonedVersion(db, stuck[0]!);
      expect(await getDocument(db, accountId, id)).toBeNull();
      expect((await listAbandonedUploads(db, "2000-01-01T00:00:00Z", 500)).filter((v) => v.account_id === accountId)).toEqual([]);
    }));
});

describe("the timeline read (plan deviation 3)", () => {
  it("a contact's ready documents, trashed ones included, never one still uploading; a group page adds the group's own (mutation: drop the group read, or the current_version_id filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const pending = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Pending", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      await reserveDocumentVersion(db, { accountId, documentId: pending, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      const a = await readyDoc(db, accountId, ana, { title: "Mine" });
      const gid = await createDocument(db, { accountId, record: { kind: "group", id: g.groupId }, title: "Ours", category: "permit", expiresOn: null, ownersOnly: false, source: "camera", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: gid, bytes: 10, contentType: "image/jpeg", originalName: null, uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      expect(await markDocumentVersionReady(db, { accountId, documentId: gid, versionId: r.versionId, bytes: 10, sha256: HASH, actorId: ACTOR })).toBe(true);
      await trashDocument(db, accountId, a.id, ACTOR);
      const page = { limit: 10 };
      expect((await listDocumentTimeline(db, accountId, ana, null, page)).map((x) => [x.title, x.deleted_at !== null])).toEqual([["Mine", true]]);
      const both = await listDocumentTimeline(db, accountId, [ana], g.groupId, page);
      expect(both.map((x) => x.title).sort()).toEqual(["Mine", "Ours"]);
      expect(both.find((x) => x.title === "Ours")).toMatchObject({ source: "camera", client_group_id: g.groupId, contact_id: null });
    }));
});

/** The real client, with `storage.from(..).remove` replaced: Postgres stays real, the bucket is faked. */
function withStorage(db: SupabaseClient, remove: (paths: string[]) => Promise<{ data: unknown; error: { message: string } | null }>): SupabaseClient {
  return new Proxy(db, { get: (t, p) => (p === "storage" ? { from: () => ({ remove }) } : Reflect.get(t, p, t)) }) as SupabaseClient;
}

describe("a customer's files go with them (deviation 2)", () => {
  it("purge: objects first, then the row, then document.purged as the user, trashed files too, never a title (mutation: delete the row before the remove -> FAILS on the order; a title in document.purged -> FAILS on the payload)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await readyDoc(db, accountId, ana, { title: "A" });
      const b = await readyDoc(db, accountId, ana, { title: "B" });
      await trashDocument(db, accountId, b.id, ACTOR);
      const order: string[] = [];
      const svc = withStorage(db, async (paths) => {
        for (const p of paths) order.push(`object:${p}`);
        const { data } = await db.from("documents").select("id").in("id", [a.id, b.id]);
        order.push(`rows-left:${(data ?? []).length}`);
        return { data: [], error: null };
      });
      expect(await purgeContactDocuments(svc, accountId, [ana], "user_owner")).toEqual({ purgedDocuments: 2, keptContacts: [] });
      expect(order.filter((x) => x.startsWith("object:")).sort()).toEqual([`object:${a.path}`, `object:${b.path}`].sort());
      expect(order.filter((x) => x.startsWith("rows-left:"))[0]).toBe("rows-left:2");   // the first object went while both rows stood
      expect(await getDocument(db, accountId, a.id)).toBeNull();
      const byDoc = (x: { payload: unknown }) => (x.payload as { documentId: string }).documentId;
      expect((await events(db, accountId, "document.purged")).sort((x, y) => byDoc(x).localeCompare(byDoc(y)))).toEqual(
        [a.id, b.id].sort().map((documentId) => ({ actor_type: "user", actor_id: "user_owner", payload: { documentId, contactId: ana } })));
    }));

  it("purge reads the caller's account only: another account's customer id touches nothing (mutation: drop the purge read's account filter -> FAILS)", () =>
    withTestAccount(async (dbB, accountB) =>
      withTestAccount(async (db, accountA) => {
        const bContact = (await createContact(dbB, accountB, { firstName: "Bo" }, ACTOR)).id;
        const bDoc = await readyDoc(dbB, accountB, bContact);
        const removed: string[] = [];
        const svc = withStorage(db, async (paths) => { removed.push(...paths); return { data: [], error: null }; });
        expect(await purgeContactDocuments(svc, accountA, [bContact], "user_owner")).toEqual({ purgedDocuments: 0, keptContacts: [] });
        expect(removed).toEqual([]);
        expect(await getDocument(dbB, accountB, bDoc.id)).not.toBeNull();
        expect([...(await events(db, accountA, "document.purged")), ...(await events(dbB, accountB, "document.purged"))]).toEqual([]);
      })));

  it("a failed removal keeps that customer and its rows, says so in keptContacts, and a retry finishes (mutation: delete the row when remove failed -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const bea = (await createContact(db, accountId, { firstName: "Bea" }, ACTOR)).id;
      const a = await readyDoc(db, accountId, ana, { title: "A" });
      const a2 = await readyDoc(db, accountId, ana, { title: "A2" });
      const b = await readyDoc(db, accountId, bea, { title: "B" });
      const anaPaths = [a.path, a2.path];
      const tried: string[] = [];
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        // Every one of Ana's objects fails; once her first fails, her second must not even be tried.
        const failing = withStorage(db, async (paths) => {
          tried.push(...paths);
          return paths.some((p) => anaPaths.includes(p)) ? { data: null, error: { message: "storage down" } } : { data: [], error: null };
        });
        expect(await purgeContactDocuments(failing, accountId, [ana, bea], "user_owner")).toEqual({ purgedDocuments: 1, keptContacts: [ana] });
        expect(tried.filter((p) => anaPaths.includes(p))).toHaveLength(1);
        expect(await getDocument(db, accountId, a.id)).not.toBeNull();
        expect(await getDocument(db, accountId, a2.id)).not.toBeNull();
        expect(await getDocument(db, accountId, b.id)).toBeNull();
        expect(errors.mock.calls.some(([msg]) => String(msg).includes(ana) && (String(msg).includes(a.id) || String(msg).includes(a2.id)))).toBe(true);
      } finally {
        errors.mockRestore();
      }
      const ok = withStorage(db, async () => ({ data: [], error: null }));
      expect(await purgeContactDocuments(ok, accountId, [ana], "user_owner")).toEqual({ purgedDocuments: 2, keptContacts: [] });
      expect(await getDocument(db, accountId, a.id)).toBeNull();
    }));

  it("a failed row delete keeps that customer; a row already gone is neither counted nor announced (mutation: count without the deleted row, or drop kept.add on a failed delete -> FAILS)", async () => {
    // A fake client: the real service role can always delete the row, so only a fake reaches these branches.
    const inserted: unknown[] = [];
    const rows = [
      { id: "d1", contact_id: "c1", versions: [{ storage_path: "p1" }] },
      { id: "d2", contact_id: "c2", versions: [{ storage_path: "p2" }] },
      { id: "d3", contact_id: "c3", versions: [{ storage_path: "p3" }] },
    ];
    const answer: Record<string, { data: { id: string }[] | null; error: { message: string } | null }> = {
      d1: { data: null, error: { message: "row delete down" } },
      d2: { data: [], error: null },             // someone else's purge took it first
      d3: { data: [{ id: "d3" }], error: null },
    };
    const docs = {
      select: () => docs, eq: () => docs, in: () => docs, order: () => docs,
      range: async () => ({ data: rows, error: null }),
      delete: () => ({ eq: () => ({ eq: (_c: string, id: string) => ({ select: async () => answer[id] }) }) }),
    };
    const fake = {
      from: (t: string) => (t === "documents" ? docs : { insert: async (row: unknown) => { inserted.push(row); return { error: null }; } }),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    } as unknown as SupabaseClient;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await purgeContactDocuments(fake, "acc", ["c1", "c2", "c3"], "user_owner")).toEqual({ purgedDocuments: 1, keptContacts: ["c1"] });
      expect(inserted.map((e) => (e as { payload: { documentId: string } }).payload.documentId)).toEqual(["d3"]);
      expect(errors.mock.calls.some(([msg]) => String(msg).includes("d1") && String(msg).includes("c1"))).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it("the read pages until a short page, so no row cap can truncate it (mutation: read only the first range -> FAILS on the range count)", async () => {
    // A fake client: PostgREST's own max_rows (1000) would return a 501-row read whole, so only a fake
    // can show the loop asks again after a FULL page of 500 and stops after a short one.
    const ranges: [number, number][] = [];
    const page = (from: number, to: number) => Array.from({ length: from === 0 ? 500 : 1 }, (_, n) => ({
      id: `d${from + n}`, contact_id: "c1", versions: [] as { storage_path: string }[],
    })).slice(0, to - from + 1);
    const docs = {
      select: () => docs, eq: () => docs, in: () => docs, order: () => docs,
      range: async (from: number, to: number) => { ranges.push([from, to]); return { data: page(from, to), error: null }; },
      delete: () => ({ eq: () => ({ eq: (_c: string, id: string) => ({ select: async () => ({ data: [{ id }], error: null }) }) }) }),
    };
    const fake = {
      from: (t: string) => (t === "documents" ? docs : { insert: async () => ({ error: null }) }),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    } as unknown as SupabaseClient;
    const r = await purgeContactDocuments(fake, "acc", ["c1"], "user_owner");
    expect(ranges).toEqual([[0, 499], [500, 999]]);
    expect(r.purgedDocuments).toBe(501);
  });

  it("never throws after the first deletion: a later chunk's failed read keeps its contacts and the answer comes back (mutation: rethrow after a deletion -> FAILS)", async () => {
    // A fake client: 101 ids are two chunks of 100; chunk 1 holds one file, chunk 2's read fails.
    const ids = Array.from({ length: 101 }, (_, n) => `c${n}`);
    let chunk: string[] = [];
    const removed: string[] = [];
    const docs = {
      select: () => docs, eq: () => docs, order: () => docs,
      in: (_c: string, v: string[]) => { chunk = v; return docs; },
      range: async () => (chunk.includes("c100")
        ? { data: null, error: { message: "read down" } }
        : { data: [{ id: "d0", contact_id: "c0", versions: [{ storage_path: "acc/d0/v0" }] }], error: null }),
      delete: () => ({ eq: () => ({ eq: (_c: string, id: string) => ({ select: async () => ({ data: [{ id }], error: null }) }) }) }),
    };
    const fake = {
      from: (t: string) => (t === "documents" ? docs : { insert: async () => ({ error: null }) }),
      storage: { from: () => ({ remove: async (paths: string[]) => { removed.push(...paths); return { data: [], error: null }; } }) },
    } as unknown as SupabaseClient;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await purgeContactDocuments(fake, "acc", ids, "user_owner")).toEqual({ purgedDocuments: 1, keptContacts: ["c100"] });
      expect(removed).toEqual(["acc/d0/v0"]);
      expect(errors.mock.calls.some(([msg]) => String(msg).includes("read down") && String(msg).includes("c100"))).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it("a deleted row with no stored object counts as a deletion too (mutation: only a removed object marks the purge as started -> FAILS)", async () => {
    // A document still being created has no version yet: its row goes with no remove call at all.
    const ids = Array.from({ length: 101 }, (_, n) => `c${n}`);
    let chunk: string[] = [];
    const docs = {
      select: () => docs, eq: () => docs, order: () => docs,
      in: (_c: string, v: string[]) => { chunk = v; return docs; },
      range: async () => (chunk.includes("c100")
        ? { data: null, error: { message: "read down" } }
        : { data: [{ id: "d0", contact_id: "c0", versions: [] }], error: null }),
      delete: () => ({ eq: () => ({ eq: (_c: string, id: string) => ({ select: async () => ({ data: [{ id }], error: null }) }) }) }),
    };
    const fake = {
      from: (t: string) => (t === "documents" ? docs : { insert: async () => ({ error: null }) }),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    } as unknown as SupabaseClient;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await purgeContactDocuments(fake, "acc", ids, "user_owner")).toEqual({ purgedDocuments: 1, keptContacts: ["c100"] });
    } finally {
      errors.mockRestore();
    }
  });

  it("a failed read before anything is removed still throws: nothing is gone, so try again is true (mutation: swallow every read error -> FAILS)", async () => {
    const docs = {
      select: () => docs, eq: () => docs, in: () => docs, order: () => docs,
      range: async () => ({ data: null, error: { message: "read down" } }),
    };
    const fake = { from: () => docs, storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } } as unknown as SupabaseClient;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(purgeContactDocuments(fake, "acc", ["c1"], "user_owner")).rejects.toThrow(/read down/);
    } finally {
      errors.mockRestore();
    }
  });

  it("the dialog's count includes trashed files and other contacts' files never count (mutation: filter deleted_at is null -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const bea = (await createContact(db, accountId, { firstName: "Bea" }, ACTOR)).id;
      await readyDoc(db, accountId, ana, { title: "A" });
      const t = await readyDoc(db, accountId, ana, { title: "T" });
      await trashDocument(db, accountId, t.id, ACTOR);
      await readyDoc(db, accountId, bea, { title: "B" });
      expect(await countContactDocuments(db, accountId, [ana])).toBe(2);
      expect(await countContactDocuments(db, accountId, [ana, bea])).toBe(3);
    }));

  it("a null head count throws, never reads as zero (mutation: `count ?? 0` -> FAILS)", async () => {
    const chain = { select: () => chain, eq: () => chain, in: async () => ({ count: null, error: null }) };
    const fake = { from: () => chain } as unknown as SupabaseClient;
    await expect(countContactDocuments(fake, "acc", ["c1"])).rejects.toThrow(/null/);
  });
});

/** A second version of `id`, reserved and made ready at BYTES, as the new-version start and finish do. */
async function newVersion(db: SupabaseClient, accountId: string, id: string) {
  const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: BYTES, contentType: "application/pdf", originalName: "v.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(`reserve: ${r.status}`);
  expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: BYTES, sha256: HASH, actorId: ACTOR })).toBe(true);
  return r;
}

describe("versions in the card's read (spec 3.3, 4.1, 4.3)", () => {
  it("every ready version, newest first, the current one first; one still uploading is never listed; the new version emits document.version_added (mutations: drop the ready filter -> FAILS; sort oldest first -> FAILS; emit nothing for a later version -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const v2 = await newVersion(db, accountId, d.id);
      const pending = await reserveDocumentVersion(db, { accountId, documentId: d.id, bytes: BYTES, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (pending.status !== "ok") throw new Error(pending.status);
      const [listed] = (await listRecordDocuments(db, accountId, { kind: "contact", id: ana })).live;
      expect(listed!.version.id).toBe(v2.versionId);
      expect(listed!.versions.map((v) => [v.id, v.status])).toEqual([[v2.versionId, "ready"], [d.versionId, "ready"]]);
      // A PR 1a pin, not a 1b probe: a later version never emits a second document.added.
      expect(await events(db, accountId, "document.added")).toHaveLength(1);
      // 1b (owner ruling R2): it emits document.version_added, as the person, with no title or category.
      expect(await events(db, accountId, "document.version_added")).toEqual([
        { actor_type: "user", actor_id: ACTOR, payload: { documentId: d.id, versionId: v2.versionId, contactId: ana } }]);
    }));

  it("a file with one version lists exactly that one (mutation: answer [] when only the current is ready -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const [listed] = (await listRecordDocuments(db, accountId, { kind: "contact", id: ana })).live;
      expect(listed!.versions.map((v) => v.id)).toEqual([d.versionId]);
      expect(listed!.versions[0]!.bytes).toBe(BYTES);
    }));
});

describe("the new-version timeline read (0078's view; owner ruling R2)", () => {
  it("a contact's new versions, never a file's first, newest first; a group page adds the group's own (mutations: read documents instead of the view -> FAILS; drop the group read -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const mine = await readyDoc(db, accountId, ana, { title: "Mine" });
      const v2 = await newVersion(db, accountId, mine.id);
      await readyDoc(db, accountId, ana, { title: "Only one" });
      const theirsId = await createDocument(db, { accountId, record: { kind: "group", id: g.groupId }, title: "Ours", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r1 = await reserveDocumentVersion(db, { accountId, documentId: theirsId, bytes: BYTES, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (r1.status !== "ok") throw new Error(r1.status);
      await markDocumentVersionReady(db, { accountId, documentId: theirsId, versionId: r1.versionId, bytes: BYTES, sha256: HASH, actorId: ACTOR });
      const ours2 = await newVersion(db, accountId, theirsId);
      const page = { limit: 31 };
      const contactRows = await listDocumentVersionTimeline(db, accountId, ana, null, page);
      expect(contactRows.map((x) => [x.id, x.document_id, x.title, x.uploaded_by])).toEqual([[v2.versionId, mine.id, "Mine", ACTOR]]);
      const groupRows = await listDocumentVersionTimeline(db, accountId, [ana], g.groupId, page);
      expect(groupRows.map((x) => x.id).sort()).toEqual([v2.versionId, ours2.versionId].sort());
    }));
});

describe("the space-used read (0078; spec 4.2 item 4)", () => {
  const fake = (answer: { data: unknown; error: { message: string } | null }) => {
    const calls: unknown[][] = [];
    const client = { rpc: async (...a: unknown[]) => { calls.push(a); return answer; } } as unknown as SupabaseClient;
    return { client, calls };
  };
  it("calls document_space_used with the account and answers its number; a numeric string is read as a number (mutation: rpc another name -> FAILS)", async () => {
    const f = fake({ data: 4_402_341_479, error: null });
    expect(await documentSpaceUsed(f.client, "acc-1")).toBe(4_402_341_479);
    expect(f.calls).toEqual([["document_space_used", { p_account_id: "acc-1" }]]);
    expect(await documentSpaceUsed(fake({ data: "725", error: null }).client, "acc-1")).toBe(725);
  });
  it("a null, a non-integer or an error throws, never reads as zero (mutation: `Number(data ?? 0)` -> FAILS on the null case)", async () => {
    await expect(documentSpaceUsed(fake({ data: null, error: null }).client, "a")).rejects.toThrow(/unexpected answer/);
    await expect(documentSpaceUsed(fake({ data: "x", error: null }).client, "a")).rejects.toThrow(/unexpected answer/);
    await expect(documentSpaceUsed(fake({ data: -1, error: null }).client, "a")).rejects.toThrow(/unexpected answer/);
    await expect(documentSpaceUsed(fake({ data: null, error: { message: "42501" } }).client, "a")).rejects.toThrow(/documentSpaceUsed failed: 42501/);
  });
});

describe("Delete forever's writes (spec 4.4, 5.1; deviations 3 and 4)", () => {
  it("the version states are this document's, every version, its status included (mutation: drop the document filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const other = await readyDoc(db, accountId, ana, { title: "Other" });
      const pending = await reserveDocumentVersion(db, { accountId, documentId: d.id, bytes: BYTES, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (pending.status !== "ok") throw new Error(pending.status);
      const states = await listDocumentVersionStates(db, accountId, d.id);
      expect(states.map((s) => [s.storage_path, s.status]).sort()).toEqual([[d.path, "ready"], [pending.storagePath, "uploading"]].sort());
      expect(states.map((s) => s.storage_path)).not.toContain(other.path);
    }));

  it("answers EVERY version past PostgREST's 1000-row cap, so the purge's object list is never cut short (review M5 and its re-review; mutation: read only the first page -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      // 1001 more, inserted directly (the reserve rpc would take a round trip each): 1002 in all, past
      // max_rows = 1000 (config.toml, the kit, hosted), which caps a single read silently.
      const extra = Array.from({ length: 1001 }, () => {
        const id = crypto.randomUUID();
        return { id, document_id: d.id, account_id: accountId, storage_path: `${accountId}/${d.id}/${id}`, bytes: 1,
          content_type: "application/pdf", uploaded_by: ACTOR, status: "uploading" };
      });
      const { error } = await db.from("document_versions").insert(extra);
      if (error) throw error;
      const states = await listDocumentVersionStates(db, accountId, d.id);
      expect(states).toHaveLength(1002);
      expect(states.map((s) => s.storage_path).sort()).toEqual([d.path, ...extra.map((v) => v.storage_path)].sort());
    }));

  it("the claim re-stamps deleted_at and marks the row only while it still holds the instant the proof read; no Restore, old instant or new, brings it back (mutations: claim without .eq('deleted_at', expected) -> FAILS on the wrong-instant case; claim without changing deleted_at -> FAILS on the new instant equalling the old (and on the delete case's stale call); drop restoreDocument's marker filter -> FAILS on the new-instant restore)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const t = await trashDocument(db, accountId, d.id, ACTOR);
      if (t.status !== "trashed") throw new Error(t.status);
      expect(await claimDocumentForPurge(db, accountId, d.id, "2020-01-01T00:00:00+00:00")).toBeNull();
      expect((await getDocument(db, accountId, d.id))!.deleted_at).toBe(t.deletedAt);
      const claimed = await claimDocumentForPurge(db, accountId, d.id, t.deletedAt);
      expect(claimed).not.toBeNull();
      expect(claimed).not.toBe(t.deletedAt);
      expect(await restoreDocument(db, accountId, d.id, t.deletedAt, ACTOR)).toBe("changed");
      // Review M1 (a): a Restore that read AFTER the claim carries the new instant; the marker refuses it.
      expect(await restoreDocument(db, accountId, d.id, claimed!, ACTOR)).toBe("changed");
      const after = (await getDocument(db, accountId, d.id))!;
      expect([after.deleted_at, after.deleted_by]).toEqual([claimed, DOCUMENT_PURGING_MARK]);
      // A purge that failed part-way is finished by another claim on the row's current instant.
      expect(await claimDocumentForPurge(db, accountId, d.id, claimed!)).not.toBeNull();
    }));

  it("a live document is never claimed (mutation: drop .eq('deleted_at', expectedDeletedAt) in the claim -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const doc = (await getDocument(db, accountId, d.id))!;
      expect(await claimDocumentForPurge(db, accountId, d.id, doc.created_at)).toBeNull();
      expect((await getDocument(db, accountId, d.id))!.deleted_at).toBeNull();
    }));

  it("the delete takes the claimed row and every version, then one document.purged as the person, with no title (mutations: emit as system -> FAILS; a title in the payload -> FAILS; delete without the claimed instant -> FAILS on the stale case)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana, { title: "Secret plan" });
      await newVersion(db, accountId, d.id);
      const t = await trashDocument(db, accountId, d.id, ACTOR);
      if (t.status !== "trashed") throw new Error(t.status);
      const claimed = (await claimDocumentForPurge(db, accountId, d.id, t.deletedAt))!;
      const row = (await getDocument(db, accountId, d.id))!;
      expect(await deletePurgedDocument(db, accountId, row, t.deletedAt, "user_owner")).toBe(false);   // stale instant
      expect(await getDocument(db, accountId, d.id)).not.toBeNull();
      expect(await deletePurgedDocument(db, accountId, row, claimed, "user_owner")).toBe(true);
      expect(await getDocument(db, accountId, d.id)).toBeNull();
      const { data: left, error } = await db.from("document_versions").select("id").eq("document_id", d.id);
      if (error) throw error;
      expect(left ?? []).toEqual([]);
      expect(await events(db, accountId, "document.purged")).toEqual([
        { actor_type: "user", actor_id: "user_owner", payload: { documentId: d.id, contactId: ana } }]);
    }));
});

describe("virus scanning's reads and writes (S-07 2a; spec 3.2-3.4)", () => {
  /** A version's verdict as the service client records it after a scan, for the read cases. */
  const verdict = (db: SupabaseClient, accountId: string, versionId: string, v: "clean" | "infected" | "unscannable") =>
    recordDocumentScan(db, { accountId, versionId, verdict: v, signature: v === "infected" ? "Eicar-Test-Signature" : null });

  it("the card's read carries each version's scan state; a new upload is pending (mutation: drop scan_status from VERSION_COLS -> undefined -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const list = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect(list.live[0]!.version.scan_status).toBe("pending");
      expect(list.live[0]!.versions.map((v) => v.scan_status)).toEqual(["pending"]);
      await verdict(db, accountId, d.versionId, "clean");
      const again = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect(again.live[0]!.version.scan_status).toBe("clean");
    }));

  it("the read gate refuses every state but clean WITHOUT touching storage (the replica's gateway 404s any storage call, so a mint would throw) (mutation: drop the scan checks -> the pending case reaches storage and throws -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const pending = await readyDoc(db, accountId, ana, { title: "P" });
      const infected = await readyDoc(db, accountId, ana, { title: "I" });
      const unscannable = await readyDoc(db, accountId, ana, { title: "U" });
      await verdict(db, accountId, infected.versionId, "infected");
      await verdict(db, accountId, unscannable.versionId, "unscannable");
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Up", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const up = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (up.status !== "ok") throw new Error(up.status);
      const ask = (versionId: string) => signedDocumentReadUrl(db, accountId, versionId, { seconds: 120 });
      expect(await ask(pending.versionId)).toEqual({ status: "pending" });
      expect(await ask(infected.versionId)).toEqual({ status: "removed" });
      expect(await ask(unscannable.versionId)).toEqual({ status: "removed" });
      expect(await ask(up.versionId)).toEqual({ status: "not_ready" });
      expect(await ask("00000000-0000-4000-8000-000000000000")).toEqual({ status: "not_found" });
    }));

  it("the read gate reads the version ITSELF, scoped to the account: another account's clean version is not_found (mutation: drop .eq('account_id') -> it reaches storage and throws -> FAILS)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (dbB, accountB) => {
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        const theirs = await readyDoc(dbB, accountB, bea);
        await verdict(dbB, accountB, theirs.versionId, "clean");
        expect(await signedDocumentReadUrl(db, accountId, theirs.versionId, { seconds: 120 })).toEqual({ status: "not_found" });
      })));

  it("a verdict is a compare-and-set; a virus or an unscannable file is announced with the document and version ids only, as the system (mutations: put the title in the payload -> FAILS; emit as 'user' -> FAILS; emit document.virus_removed for every verdict -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await readyDoc(db, accountId, ana, { title: "Lease" });
      const b = await readyDoc(db, accountId, ana, { title: "Plan" });
      const c = await readyDoc(db, accountId, ana, { title: "Ok" });
      expect(await recordDocumentScan(db, { accountId, versionId: a.versionId, verdict: "error" })).toEqual({ status: "ok", attempts: 1 });
      expect(await recordDocumentScan(db, { accountId, versionId: a.versionId, verdict: "infected", signature: "Eicar-Test-Signature" })).toEqual({ status: "ok", attempts: 2 });
      expect(await recordDocumentScan(db, { accountId, versionId: a.versionId, verdict: "clean" })).toEqual({ status: "stale" });
      await recordDocumentScan(db, { accountId, versionId: b.versionId, verdict: "unscannable" });
      await recordDocumentScan(db, { accountId, versionId: c.versionId, verdict: "clean" });
      expect(await events(db, accountId, "document.virus_removed")).toEqual([
        { actor_type: "system", actor_id: "documents-scan", payload: { documentId: a.id, versionId: a.versionId } }]);
      expect(await events(db, accountId, "document.unscannable")).toEqual([
        { actor_type: "system", actor_id: "documents-scan", payload: { documentId: b.id, versionId: b.versionId } }]);
    }));

  it("the retry pass reads ready + pending versions oldest first, with their attempts; never an uploading one, never a scanned one; the oldest pending instant likewise (mutations: drop .eq('status','ready') -> FAILS; order descending -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const first = await readyDoc(db, accountId, ana, { title: "First" });
      // A second never-tried version (scan_tried_at still null, same as `first`): only their created_at
      // can order the two of them, so this is what actually pins "oldest first" against a descending mutation.
      const untouched = await readyDoc(db, accountId, ana, { title: "Untouched" });
      const second = await readyDoc(db, accountId, ana, { title: "Second" });
      const done = await readyDoc(db, accountId, ana, { title: "Done" });
      await verdict(db, accountId, done.versionId, "clean");
      await recordDocumentScan(db, { accountId, versionId: second.versionId, verdict: "error" });
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Up", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const up = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (up.status !== "ok") throw new Error(up.status);
      // Other accounts' rows may exist on a shared stack: judge only this account's.
      const mine = (await listPendingScans(db, 1000)).filter((p) => p.account_id === accountId);
      expect(mine.map((p) => [p.id, p.scan_attempts])).toEqual([
        [first.versionId, 0], [untouched.versionId, 0], [second.versionId, 1],
      ]);
      expect(mine[0]!.storage_path).toBe(first.path);
      const oldest = await oldestPendingScanAt(db);
      expect(oldest).not.toBeNull();
      expect(Date.parse(oldest!)).toBeLessThanOrEqual(Date.parse(mine[0]!.created_at));
    }));

  it("a version just TRIED goes behind every untried one, even an older one; the oldest-pending instant still reads by age (re-review N2b; mutations: drop the scan_tried_at order -> FAILS; read oldestPendingScanAt through the tried order -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const older = await readyDoc(db, accountId, ana, { title: "Older" });
      const newer = await readyDoc(db, accountId, ana, { title: "Newer" });
      expect(await recordDocumentScan(db, { accountId, versionId: older.versionId, verdict: "tried" })).toMatchObject({ status: "ok", attempts: 0 });
      const mine = (await listPendingScans(db, 1000)).filter((p) => p.account_id === accountId);
      expect(mine.map((p) => p.id)).toEqual([newer.versionId, older.versionId]);
      expect(mine[1]!.scan_tried_at).not.toBeNull();
      const oldest = await oldestPendingScanAt(db);
      expect(Date.parse(oldest!)).toBeLessThanOrEqual(Date.parse(mine[1]!.created_at));
    }));

  it("oldestPendingScanAt's own query chain: ready + pending only, created_at ascending, never ordered by scan_tried_at (re-review N2b; mutations: drop .eq('status','ready') -> FAILS; order descending -> FAILS; read oldestPendingScanAt through the tried order -> FAILS)", async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const builder: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
    builder.select = record("select");
    builder.eq = record("eq");
    builder.order = record("order");
    builder.limit = record("limit");
    builder.then = (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: [{ created_at: "2026-01-01T00:00:00.000Z" }], error: null });
    const from = vi.fn(() => builder);
    const db = { from } as unknown as SupabaseClient;
    const oldest = await oldestPendingScanAt(db);
    expect(from).toHaveBeenCalledWith("document_versions");
    const eqCalls = calls.filter((c) => c.method === "eq");
    expect(eqCalls.map((c) => c.args)).toEqual([["status", "ready"], ["scan_status", "pending"]]);
    const orderCalls = calls.filter((c) => c.method === "order");
    expect(orderCalls).toEqual([{ method: "order", args: ["created_at", { ascending: true }] }]);
    expect(oldest).toBe("2026-01-01T00:00:00.000Z");
  });

  it("the scanner's URL is a 120-second signed GET on the documents bucket for that one path (mutation: sign the account folder -> FAILS)", async () => {
    const createSignedUrl = vi.fn(async (path: string, seconds: number) => ({ data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/documents/${path}?token=t&s=${seconds}` }, error: null }));
    const from = vi.fn(() => ({ createSignedUrl }));
    const db = { storage: { from } } as unknown as SupabaseClient;
    const url = await signedScannerUrl(db, "a/b/c");
    expect(from).toHaveBeenCalledWith("documents");
    expect(createSignedUrl).toHaveBeenCalledWith("a/b/c", 120);
    expect(url).toBe("https://x.supabase.co/storage/v1/object/sign/documents/a/b/c?token=t&s=120");
  });

  it("the removed-file timeline read: a contact's rows and a group's own (mutation: read the group's own rows without .eq('client_group_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const mine = await readyDoc(db, accountId, ana, { title: "Mine" });
      const gid = await createDocument(db, { accountId, record: { kind: "group", id: g.groupId }, title: "Ours", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: gid, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      expect(await markDocumentVersionReady(db, { accountId, documentId: gid, versionId: r.versionId, bytes: 10, sha256: HASH, actorId: ACTOR })).toBe(true);
      await verdict(db, accountId, mine.versionId, "infected");
      await recordDocumentScan(db, { accountId, versionId: r.versionId, verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
      const contactOnly = await listDocumentScanTimeline(db, accountId, ana, null, { limit: 10 });
      expect(contactOnly.map((x) => [x.id, x.scan_status, x.title])).toEqual([[mine.versionId, "infected", "Mine"]]);
      const both = await listDocumentScanTimeline(db, accountId, ana, g.groupId, { limit: 10 });
      expect(both.map((x) => x.id).sort()).toEqual([mine.versionId, r.versionId].sort());
      const theirs = both.find((x) => x.id === r.versionId)!;
      expect(theirs.scan_signature).toBe("Heuristics.Encrypted.PDF");
      expect(removedReason(theirs.scan_status, theirs.scan_signature)).toBe("password");
    }));

  it("an unscannable version keeps its named cause on the read, and removedReason reads a password from it (owner ruling 2026-10-15; mutation: drop scan_signature from VERSION_COLS -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana, { title: "Locked" });
      await recordDocumentScan(db, { accountId, versionId: d.versionId, verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
      const v = (await listRecordDocuments(db, accountId, { kind: "contact", id: ana })).live[0]!.version;
      expect([v.scan_status, v.scan_signature, removedReason(v.scan_status, v.scan_signature)]).toEqual(["unscannable", "Heuristics.Encrypted.PDF", "password"]);
    }));
});
