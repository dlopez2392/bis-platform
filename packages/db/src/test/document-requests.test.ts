import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember } from "../client-groups";
import { markDocumentVersionReady, recordDocumentScan, createDocument, reserveDocumentVersion } from "../documents";
import {
  createDocumentRequest, findDocumentRequestByTokenHash, getDocumentRequest, startDocumentRequestUpload, getRequestDocument,
  listRequestFiles, listOpenDocumentRequests, revokeDocumentRequest, restoreDocumentRequest, listDocumentRequestTimeline,
  documentRequestTarget, ensureDocumentRequestTask, getDocumentRequestForVersion,
} from "../document-requests";
import { cleanRequestItems, documentRequestState, isCustomerAuthor, DOCUMENT_SOURCES } from "../document-rules";

/**
 * The request module (spec 4.1-4.5) on the service client (the routes and the actions hold one AFTER
 * their proof), behind PostgREST on the replica. RLS itself is document-requests-schema.test.ts's job.
 */
const ACTOR = "user_drq_test";
const NOW = new Date();
const HEX = (n: number) => n.toString(16).padStart(64, "0");
const ITEMS = [
  { key: "insurance", category: "insurance", note: null },
  { key: "other", category: "other", note: "Pool permit" },
] as const;
let n = 1;
async function made(db: SupabaseClient, accountId: string, contactId: string, over: { now?: Date } = {}) {
  return createDocumentRequest(db, {
    id: crypto.randomUUID(), accountId, record: { kind: "contact", id: contactId }, items: [...ITEMS], language: "es",
    tokenHash: HEX(n++), channel: "link", createdBy: ACTOR, now: over.now ?? NOW,
  });
}
async function cleanFile(db: SupabaseClient, accountId: string, requestId: string, itemKey: string) {
  const s = await startDocumentRequestUpload(db, { accountId, requestId, itemKey, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", title: "Seguro" });
  if (s.status !== "ok") throw new Error(s.status);
  expect(await markDocumentVersionReady(db, { accountId, documentId: s.documentId, versionId: s.versionId, bytes: 10, sha256: "a".repeat(64), actorId: `customer:${requestId}`, actorType: "system" })).toBe(true);
  await recordDocumentScan(db, { accountId, versionId: s.versionId, verdict: "clean" });
  return s;
}

describe("document-rules: the request's pure rules (spec 4.1)", () => {
  it("cleanRequestItems keeps the SQL check's rules (mutations: allow 10 items; allow a note on insurance; allow a duplicate -> FAILS)", () => {
    expect(cleanRequestItems([{ key: "id", category: "id", note: null }, { key: "other", category: "other", note: "  Pool permit " }]))
      .toEqual([{ key: "id", category: "id", note: null }, { key: "other", category: "other", note: "Pool permit" }]);
    const nine = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"]
      .map((k) => ({ key: k, category: k, note: k === "other" ? "x" : null }));
    expect(cleanRequestItems(nine)).toHaveLength(9);
    for (const bad of [[], [...nine, nine[0]], [{ key: "id", category: "id", note: "x" }], [{ key: "other", category: "other", note: "" }],
      [{ key: "other", category: "other", note: "x".repeat(81) }], [{ key: "id", category: "insurance", note: null }],
      [{ key: "id", category: "id", note: null }, { key: "id", category: "id", note: null }], "id", null,
      // 0071's app.tidy_text treats U+0085 (NEL) as whitespace (Unicode's White_Space property), but
      // JS's String.prototype.trim() does not strip it: a note trimmed in the browser could still carry
      // one at an edge and pass here while the SQL check (document_request_items_ok) refuses the insert.
      [{ key: "other", category: "other", note: "\u0085Pool permit" }], [{ key: "other", category: "other", note: "Pool permit\u0085" }]]) {
      expect(cleanRequestItems(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it("documentRequestState answers revoked, then completed, then expired, else open (mutation: check expiry first -> FAILS)", () => {
    const at = "2026-10-20T00:00:00.000Z";
    const now = new Date("2026-10-21T00:00:00.000Z");
    expect(documentRequestState({ revoked_at: at, completed_at: at, expires_at: at }, now)).toBe("revoked");
    expect(documentRequestState({ revoked_at: null, completed_at: at, expires_at: at }, now)).toBe("completed");
    expect(documentRequestState({ revoked_at: null, completed_at: null, expires_at: at }, now)).toBe("expired");
    expect(documentRequestState({ revoked_at: null, completed_at: null, expires_at: "2026-10-22T00:00:00.000Z" }, now)).toBe("open");
  });
  it("customer is a source and 'customer:' marks a customer author (mutation: drop customer from DOCUMENT_SOURCES -> FAILS)", () => {
    expect(DOCUMENT_SOURCES).toEqual(["upload", "camera", "customer"]);
    expect([isCustomerAuthor("customer:abc"), isCustomerAuthor("user_1"), isCustomerAuthor(null)]).toEqual([true, false, false]);
  });
});

describe("document-requests: create, find, start (spec 4.1, 4.4)", () => {
  it("creates a request that expires 7 days on and finds it by its hash, never answering the hash (mutation: expires_at +6 days -> the insert FAILS; select token_hash -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      expect(Date.parse(r.expires_at) - Date.parse(r.created_at)).toBe(7 * 86_400_000);
      const found = await findDocumentRequestByTokenHash(db, HEX(n - 1));
      expect(found?.id).toBe(r.id);
      expect(Object.keys(found!)).not.toContain("token_hash");
      expect(await findDocumentRequestByTokenHash(db, HEX(999_999))).toBeNull();
      expect((await getDocumentRequest(db, accountId, r.id))?.items).toEqual(ITEMS);
    }));

  it("start answers ok with the ids and every refusal by name; getRequestDocument reads only this request's file in this account (mutation: drop .eq('request_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await made(db, accountId, ana);
      const b = await made(db, accountId, ana);
      const s = await startDocumentRequestUpload(db, { accountId, requestId: a.id, itemKey: "insurance", bytes: 10, contentType: "application/pdf", originalName: "a.pdf", title: "Seguro" });
      expect(s.status).toBe("ok");
      if (s.status !== "ok") return;
      expect(s.storagePath).toBe(`${accountId}/${s.documentId}/${s.versionId}`);
      expect((await getRequestDocument(db, accountId, a.id, s.documentId))?.request_item_key).toBe("insurance");
      expect(await getRequestDocument(db, accountId, b.id, s.documentId)).toBeNull();
      expect((await startDocumentRequestUpload(db, { accountId, requestId: a.id, itemKey: "warranty", bytes: 10, contentType: "application/pdf", originalName: null, title: "X" })).status).toBe("no_item");
    }));
});

describe("document-requests: what the card and the page read (spec 4.2, 4.3, 4.5)", () => {
  it("an item is answered only by a clean, ready, non-trashed file; a completed request leaves the open list (mutation: count a pending file as answered -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      const pending = await startDocumentRequestUpload(db, { accountId, requestId: r.id, itemKey: "other", bytes: 10, contentType: "application/pdf", originalName: "p.pdf", title: "Pool permit" });
      if (pending.status !== "ok") throw new Error(pending.status);
      await markDocumentVersionReady(db, { accountId, documentId: pending.documentId, versionId: pending.versionId, bytes: 10, sha256: "b".repeat(64), actorId: `customer:${r.id}`, actorType: "system" });
      await cleanFile(db, accountId, r.id, "insurance");
      const [open] = await listOpenDocumentRequests(db, accountId, { kind: "contact", id: ana }, new Date());
      expect(open!.items.map((i) => [i.key, i.answered])).toEqual([["insurance", true], ["other", false]]);
      const files = await listRequestFiles(db, accountId, r.id);
      expect(files.map((f) => [f.itemKey, f.ready, f.scanStatus])).toEqual([["other", true, "pending"], ["insurance", true, "clean"]]);
      await recordDocumentScan(db, { accountId, versionId: pending.versionId, verdict: "clean" });
      expect(await listOpenDocumentRequests(db, accountId, { kind: "contact", id: ana }, new Date())).toEqual([]);
      expect((await getDocumentRequest(db, accountId, r.id))?.completed_at).not.toBeNull();
    }));

  it("revoke is compare-and-set on an open request and its undo restores only that revoke (mutation: drop .is('revoked_at', null) -> a second revoke answers -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      const first = await revokeDocumentRequest(db, accountId, r.id, ACTOR, new Date());
      expect(first?.revokedAt).toMatch(/^\d{4}-/);
      expect(await revokeDocumentRequest(db, accountId, r.id, ACTOR, new Date())).toBeNull();
      expect(await restoreDocumentRequest(db, accountId, r.id, "2000-01-01T00:00:00.000Z")).toBe(false);
      expect(await restoreDocumentRequest(db, accountId, r.id, first!.revokedAt)).toBe(true);
      expect((await getDocumentRequest(db, accountId, r.id))?.revoked_at).toBeNull();
      expect(await listOpenDocumentRequests(db, accountId, { kind: "contact", id: ana }, new Date())).toHaveLength(1);
    }));

  it("the timeline read pages on created_at and covers a group's own requests (mutation: drop the group read -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const mine = await made(db, accountId, ana);
      const casa = await createDocumentRequest(db, { id: crypto.randomUUID(), accountId, record: { kind: "group", id: g.groupId }, items: [{ key: "id", category: "id", note: null }], language: "en", tokenHash: HEX(n++), channel: "email", createdBy: ACTOR, now: new Date() });
      const rows = await listDocumentRequestTimeline(db, accountId, [ana], g.groupId, { limit: 10 });
      expect(rows.map((x) => x.id).sort()).toEqual([mine.id, casa.id].sort());
      expect(rows.find((x) => x.id === casa.id)).toMatchObject({ client_group_id: g.groupId, contact_id: null, channel: "email", created_by: ACTOR });
    }));

  it("the target of a group request is its primary contact; of a contact, itself (mutation: read the first member instead of is_primary_contact -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", lastName: "García", email: "ana@example.com" }, ACTOR)).id;
      const bo = (await createContact(db, accountId, { firstName: "Bo" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, bo, "household", "Casa García", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      await db.from("client_group_members").insert({ account_id: accountId, client_group_id: g.groupId, contact_id: ana, is_primary_contact: true });
      expect(await documentRequestTarget(db, accountId, { contact_id: ana, client_group_id: null }))
        .toMatchObject({ name: "Ana García", contactId: ana, email: "ana@example.com" });
      expect(await documentRequestTarget(db, accountId, { contact_id: null, client_group_id: g.groupId }))
        .toMatchObject({ name: "Casa García", contactId: ana, email: "ana@example.com" });
    }));

  it("ensureDocumentRequestTask opens one To-do per request and kind (mutation: no 23505 read-back -> the second call throws -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      const a = await ensureDocumentRequestTask(db, accountId, { requestId: r.id, kind: "received", contactId: ana, title: "Ana sent documents · Review", dueAt: new Date().toISOString() }, "documents-request");
      const again = await ensureDocumentRequestTask(db, accountId, { requestId: r.id, kind: "received", contactId: ana, title: "x", dueAt: new Date().toISOString() }, "documents-request");
      expect([a.created, again.created, again.id === a.id]).toEqual([true, false, true]);
      const { data } = await db.from("tasks").select("title, document_request_kind").eq("id", a.id).single();
      expect(data).toEqual({ title: "Ana sent documents · Review", document_request_kind: "received" });
    }));

  it("getDocumentRequestForVersion answers the request for a customer file's version and null for a staff file's version (mutation: read documents.id instead of request_id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      const s = await cleanFile(db, accountId, r.id, "insurance");
      expect((await getDocumentRequestForVersion(db, accountId, s.versionId))?.id).toBe(r.id);
      const staffDocId = await createDocument(db, {
        accountId, record: { kind: "contact", id: ana }, title: "Staff", category: "other", expiresOn: null,
        ownersOnly: false, source: "upload", createdBy: ACTOR,
      });
      const staffVersion = await reserveDocumentVersion(db, {
        accountId, documentId: staffDocId, bytes: 10, contentType: "application/pdf", originalName: "s.pdf", uploadedBy: ACTOR,
      });
      if (staffVersion.status !== "ok") throw new Error(staffVersion.status);
      await markDocumentVersionReady(db, { accountId, documentId: staffDocId, versionId: staffVersion.versionId, bytes: 10, sha256: "c".repeat(64), actorId: ACTOR });
      expect(await getDocumentRequestForVersion(db, accountId, staffVersion.versionId)).toBeNull();
    }));
});
