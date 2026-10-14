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
} from "../documents";

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
  it("a contact's ready documents, trashed ones included; a group page adds the group's own (mutation: drop the group read -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
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
  it("purge: objects first, then the row, then document.purged as the user, trashed files too (mutation: delete the row before the remove -> FAILS on the order)", () =>
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
      expect((await events(db, accountId, "document.purged")).map((e) => `${e.actor_type}:${e.actor_id}`))
        .toEqual(["user:user_owner", "user:user_owner"]);
    }));

  it("a failed removal keeps that customer and its rows, says so in keptContacts, and a retry finishes (mutation: delete the row when remove failed -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const bea = (await createContact(db, accountId, { firstName: "Bea" }, ACTOR)).id;
      const a = await readyDoc(db, accountId, ana, { title: "A" });
      const b = await readyDoc(db, accountId, bea, { title: "B" });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const failing = withStorage(db, async (paths) => (paths.includes(a.path) ? { data: null, error: { message: "storage down" } } : { data: [], error: null }));
        expect(await purgeContactDocuments(failing, accountId, [ana, bea], "user_owner")).toEqual({ purgedDocuments: 1, keptContacts: [ana] });
        expect(await getDocument(db, accountId, a.id)).not.toBeNull();
        expect(await getDocument(db, accountId, b.id)).toBeNull();
        expect(errors.mock.calls.some(([msg]) => String(msg).includes(a.id) && String(msg).includes(ana))).toBe(true);
      } finally {
        errors.mockRestore();
      }
      const ok = withStorage(db, async () => ({ data: [], error: null }));
      expect(await purgeContactDocuments(ok, accountId, [ana], "user_owner")).toEqual({ purgedDocuments: 1, keptContacts: [] });
      expect(await getDocument(db, accountId, a.id)).toBeNull();
    }));

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
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    };
    const fake = {
      from: (t: string) => (t === "documents" ? docs : { insert: async () => ({ error: null }) }),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    } as unknown as SupabaseClient;
    const r = await purgeContactDocuments(fake, "acc", ["c1"], "user_owner");
    expect(ranges).toEqual([[0, 499], [500, 999]]);
    expect(r.purgedDocuments).toBe(501);
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
