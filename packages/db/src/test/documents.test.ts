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
