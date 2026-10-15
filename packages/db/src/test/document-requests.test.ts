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
  listRequestsMissingReceivedTask, claimDocumentRequestSend, clearDocumentRequestSend,
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
  it("cleanRequestItems keeps the SQL check's rules (mutations: cap at 8 -> FAILS (the nine-item case); allow a note on insurance; allow a duplicate -> FAILS)", () => {
    expect(cleanRequestItems([{ key: "id", category: "id", note: null }, { key: "other", category: "other", note: "  Pool permit " }]))
      .toEqual([{ key: "id", category: "id", note: null }, { key: "other", category: "other", note: "Pool permit" }]);
    const nine = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"]
      .map((k) => ({ key: k, category: k, note: k === "other" ? "x" : null }));
    // mutation: cap at 8 -> FAILS (the nine-item case). Raising the cap to 10 instead cannot be
    // observed through any content-based case: DOCUMENT_CATEGORIES has exactly 9 values, so a 10-item
    // array built from valid categories always has a repeated key, and the distinctness check below
    // (seen.has(category)) refuses it regardless of the length bound; verified directly (temporarily
    // widening the bound to 10 left every case in this test green).
    expect(cleanRequestItems(nine)).toHaveLength(9);
    for (const bad of [[], [...nine, nine[0]], [{ key: "id", category: "id", note: "x" }], [{ key: "other", category: "other", note: "" }],
      [{ key: "other", category: "other", note: "x".repeat(81) }], [{ key: "id", category: "insurance", note: null }],
      [{ key: "id", category: "id", note: null }, { key: "id", category: "id", note: null }], "id", null,
      // 0071's app.tidy_text refuses an edge character from Postgres's [:space:] class that JS's
      // String.prototype.trim() does not strip: U+001C-U+001F (the File/Group/Record/Unit separators)
      // and U+0085 (NEL). A note trimmed in the browser could still carry one of these at an edge and
      // pass here while the SQL check (document_request_items_ok) refuses the insert.
      [{ key: "other", category: "other", note: "\u0085Pool permit" }], [{ key: "other", category: "other", note: "Pool permit\u0085" }],
      [{ key: "other", category: "other", note: "\u001cPool permit" }], [{ key: "other", category: "other", note: "Pool permit\u001d" }],
      [{ key: "other", category: "other", note: "\u001ePool permit" }], [{ key: "other", category: "other", note: "Pool permit\u001f" }]]) {
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

  it("getRequestDocument is scoped to the CALLER's account, not just the request and document ids (mutation: drop .eq('account_id') -> FAILS)", () =>
    withTestAccount(async (dbB, accountB) =>
      withTestAccount(async (db, accountId) => {
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        const theirs = await made(dbB, accountB, bea);
        const s = await startDocumentRequestUpload(dbB, { accountId: accountB, requestId: theirs.id, itemKey: "insurance", bytes: 10, contentType: "application/pdf", originalName: "b.pdf", title: "Seguro" });
        if (s.status !== "ok") throw new Error(s.status);
        // Real ids from a REAL other account: without the account filter this still finds the row,
        // because request_id and document id are each globally unique and the caller's accountId is
        // otherwise unused by the rest of the query.
        expect(await getRequestDocument(db, accountId, theirs.id, s.documentId)).toBeNull();
      })));
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

  it("listOpenDocumentRequests is scoped to the CALLER's account: a real other account's open request, under its own real contact id, is invisible (mutation: drop the outer .eq('account_id') -> FAILS)", () =>
    withTestAccount(async (dbB, accountB) =>
      withTestAccount(async (db, accountId) => {
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        await made(dbB, accountB, bea);
        expect(await listOpenDocumentRequests(dbB, accountB, { kind: "contact", id: bea }, new Date())).toHaveLength(1);
        // Same real contact id, called with a DIFFERENT (but equally real) account: contact ids are a
        // global PK, so only the outer .eq("account_id", accountId) on the document_requests read stops
        // this from finding Bea's request. (The inner "file read" account filter this case was also
        // asked to cover is provably redundant given it: see the report's note on this probe.)
        expect(await listOpenDocumentRequests(db, accountId, { kind: "contact", id: bea }, new Date())).toEqual([]);
      })));

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

/**
 * N clean customer files, one item each, inserted directly (service client) rather than through the
 * app's upload/finish/scan round trips, so the "101 missing requests" case does not need 101 * 4
 * network calls — and in exactly 3 bulk inserts (one per table) rather than ~3 per row (fix round 2,
 * point 2), so 101 rows cost 3 round trips, not ~303. Every row still satisfies the real constraints
 * (documents_request_coherent, document_versions_scan_coherent, the path-shape check).
 *
 * This is NOT the same end state `cleanFile` (via markDocumentVersionReady + recordDocumentScan)
 * produces (fix round 2, point 3): `completed_at` is set by a trigger that fires on an UPDATE of
 * document_versions.scan_status (0080), and these versions are born already `scan_status = 'clean'`
 * rather than updated into it, so a request built this way never gets its `completed_at` stamped even
 * when every item has a clean file. That is fine here — every test using this helper asks only
 * "is this request missing a 'received' To-do", which reads `revoked_at` and `recent()` (itself keyed
 * on `completed_at`/`expires_at`, not on whether the request is literally "complete"), never whether
 * the request completed by the real trigger path.
 */
async function fastCleanRequests(db: SupabaseClient, accountId: string, contactId: string, createdAts: string[]): Promise<string[]> {
  const reqIds = createdAts.map(() => crypto.randomUUID());
  const docIds = createdAts.map(() => crypto.randomUUID());
  const verIds = createdAts.map(() => crypto.randomUUID());
  const { error: reqErr } = await db.from("document_requests").insert(createdAts.map((createdAt, i) => ({
    id: reqIds[i], account_id: accountId, contact_id: contactId,
    items: [{ key: "insurance", category: "insurance", note: null }], language: "en", token_hash: HEX(n++), channel: "link",
    created_by: ACTOR, created_at: createdAt, expires_at: new Date(Date.parse(createdAt) + 7 * 86_400_000).toISOString(),
  })));
  if (reqErr) throw reqErr;
  const { error: docErr } = await db.from("documents").insert(createdAts.map((createdAt, i) => ({
    id: docIds[i], account_id: accountId, contact_id: contactId, title: "Seguro", category: "insurance", source: "customer",
    created_by: `customer:${reqIds[i]}`, request_id: reqIds[i], request_item_key: "insurance", created_at: createdAt,
  })));
  if (docErr) throw docErr;
  const { error: verErr } = await db.from("document_versions").insert(createdAts.map((createdAt, i) => ({
    id: verIds[i], account_id: accountId, document_id: docIds[i], storage_path: `${accountId}/${docIds[i]}/${verIds[i]}`,
    bytes: 10, content_type: "application/pdf", sha256: "a".repeat(64), uploaded_by: `customer:${reqIds[i]}`,
    status: "ready", scan_status: "clean", scanned_at: createdAt, created_at: createdAt,
  })));
  if (verErr) throw verErr;
  return reqIds;
}

describe("document-requests: the 'received' reconcile and the send stamp (plan review I5, re-review R1)", () => {
  it("lists a request with a clean file and no task; not once the task exists; not revoked, pending, or completed/expired more than a day ago; expired 2h ago IS listed (mutations: drop the clean filter -> FAILS; drop .is('revoked_at', null) -> FAILS; drop the task subtraction -> FAILS; make the expired-24h branch open-only -> FAILS; drop the completed branch -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const now = new Date();

      // 1) listed, then 2) not listed once the task exists.
      const ana1 = (await createContact(db, accountId, { firstName: "Ana1" }, ACTOR)).id;
      const r1 = await made(db, accountId, ana1);
      await cleanFile(db, accountId, r1.id, "insurance");
      expect((await listRequestsMissingReceivedTask(db, now, 50)).map((r) => r.id)).toContain(r1.id);
      await ensureDocumentRequestTask(db, accountId, { requestId: r1.id, kind: "received", contactId: ana1, title: "x", dueAt: now.toISOString() }, "documents-request");
      expect((await listRequestsMissingReceivedTask(db, now, 50)).map((r) => r.id)).not.toContain(r1.id);

      // 3) revoked: a clean file, no task, but withdrawn — never listed.
      const ana2 = (await createContact(db, accountId, { firstName: "Ana2" }, ACTOR)).id;
      const r2 = await made(db, accountId, ana2);
      await cleanFile(db, accountId, r2.id, "insurance");
      const revoked = await revokeDocumentRequest(db, accountId, r2.id, ACTOR, now);
      expect(revoked).not.toBeNull();
      expect((await listRequestsMissingReceivedTask(db, now, 50)).map((r) => r.id)).not.toContain(r2.id);

      // 4) pending: the only customer file is not yet clean.
      const ana3 = (await createContact(db, accountId, { firstName: "Ana3" }, ACTOR)).id;
      const r3 = await made(db, accountId, ana3);
      const pendingStart = await startDocumentRequestUpload(db, { accountId, requestId: r3.id, itemKey: "insurance", bytes: 10, contentType: "application/pdf", originalName: "p.pdf", title: "Seguro" });
      if (pendingStart.status !== "ok") throw new Error(pendingStart.status);
      await markDocumentVersionReady(db, { accountId, documentId: pendingStart.documentId, versionId: pendingStart.versionId, bytes: 10, sha256: "d".repeat(64), actorId: `customer:${r3.id}`, actorType: "system" });
      expect((await listRequestsMissingReceivedTask(db, now, 50)).map((r) => r.id)).not.toContain(r3.id);

      // 5) completed 2 days ago: not listed (recent() reads completed_at, not expires_at, once set).
      const ana4 = (await createContact(db, accountId, { firstName: "Ana4" }, ACTOR)).id;
      const r4 = await made(db, accountId, ana4);
      await cleanFile(db, accountId, r4.id, "insurance");
      await cleanFile(db, accountId, r4.id, "other");
      expect((await getDocumentRequest(db, accountId, r4.id))?.completed_at).not.toBeNull();
      const { error: setCompletedErr } = await db.from("document_requests")
        .update({ completed_at: new Date(now.getTime() - 2 * 86_400_000).toISOString() }).eq("account_id", accountId).eq("id", r4.id);
      if (setCompletedErr) throw setCompletedErr;
      expect((await listRequestsMissingReceivedTask(db, now, 50)).map((r) => r.id)).not.toContain(r4.id);

      // 6) expired 2 HOURS ago with a clean file IS listed (re-review m1, deviation 13); expired 2 DAYS
      //    ago is not. `document_requests_expiry` forces expires_at = created_at + 7 days, so both
      //    columns move together.
      const ana5 = (await createContact(db, accountId, { firstName: "Ana5" }, ACTOR)).id;
      const r5 = await made(db, accountId, ana5);
      await cleanFile(db, accountId, r5.id, "insurance"); // only ONE of two items: stays uncompleted
      const expires5 = new Date(now.getTime() - 2 * 3_600_000).toISOString();
      const created5 = new Date(Date.parse(expires5) - 7 * 86_400_000).toISOString();
      const { error: setExpired5Err } = await db.from("document_requests")
        .update({ created_at: created5, expires_at: expires5 }).eq("account_id", accountId).eq("id", r5.id);
      if (setExpired5Err) throw setExpired5Err;
      expect((await listRequestsMissingReceivedTask(db, now, 50)).map((r) => r.id)).toContain(r5.id);

      const ana6 = (await createContact(db, accountId, { firstName: "Ana6" }, ACTOR)).id;
      const r6 = await made(db, accountId, ana6);
      await cleanFile(db, accountId, r6.id, "insurance");
      const expires6 = new Date(now.getTime() - 2 * 86_400_000).toISOString();
      const created6 = new Date(Date.parse(expires6) - 7 * 86_400_000).toISOString();
      const { error: setExpired6Err } = await db.from("document_requests")
        .update({ created_at: created6, expires_at: expires6 }).eq("account_id", accountId).eq("id", r6.id);
      if (setExpired6Err) throw setExpired6Err;
      expect((await listRequestsMissingReceivedTask(db, now, 50)).map((r) => r.id)).not.toContain(r6.id);
    }));

  it("a request with two clean files, paged one file at a time, is listed once (mutation: drop the cross-page 'seen' dedup -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const now = new Date();
      const r = await made(db, accountId, ana); // ITEMS = insurance + other: two items, two files.
      await cleanFile(db, accountId, r.id, "insurance");
      await cleanFile(db, accountId, r.id, "other");
      // filesPage: 1 forces the two files of the SAME request onto two separate file-pages; without
      // the `seen` set, the second page reprocesses the same request id and pushes it a second time.
      const out = await listRequestsMissingReceivedTask(db, now, 50, { filesPage: 1 });
      expect(out.filter((x) => x.id === r.id)).toHaveLength(1);
    }));

  it("with 101 missing requests (built in 3 bulk inserts) the batch loop still answers newest-first, and the test account's own run stays contiguous (mutation: drop the final sort -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const now = new Date();
      // Oldest first: index 0 is the oldest (furthest in the past), index 100 the newest.
      const createdAts = Array.from({ length: 101 }, (_, i) => new Date(now.getTime() - (101 - i) * 1000).toISOString());
      const ids = await fastCleanRequests(db, accountId, ana, createdAts);
      const out = await listRequestsMissingReceivedTask(db, now, 50);
      // listRequestsMissingReceivedTask reads EVERY account: a parallel test file's own committed,
      // task-less request can legitimately take one of the 50 slots, so no exact global length or
      // exact global rank-set is assertable here (fix round 2, point 1). What IS always true:
      //
      // 1) the whole answer, across every account, is sorted newest-first by created_at.
      for (let i = 1; i < out.length; i++) {
        expect(Date.parse(out[i]!.created_at)).toBeLessThanOrEqual(Date.parse(out[i - 1]!.created_at));
      }
      // 2) this test account's own 101 requests, wherever they land in `out`, form a contiguous
      //    newest-first run (ranks 100, 99, … with no gap) — never an older sibling answered while a
      //    newer one from the SAME account is missing.
      const rank = new Map(ids.map((id, i) => [id, i]));
      const mineRanks = out.filter((r) => rank.has(r.id)).map((r) => rank.get(r.id)!);
      for (let i = 1; i < mineRanks.length; i++) expect(mineRanks[i]!).toBeLessThan(mineRanks[i - 1]!);
      expect(mineRanks).toEqual(Array.from({ length: mineRanks.length }, (_, i) => 100 - i));
    }));

  it("already-tasked requests do not starve an older, genuinely missing one out of a small file page (mutation: fetch one page only, never continue -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const now = new Date();
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      // Oldest: missing (no task). Two newer ones: already tasked. A file page of 2 sees only the two
      // newest (both tasked) unless the reconcile pages PAST them for the older miss.
      const rOld = await made(db, accountId, ana);
      await cleanFile(db, accountId, rOld.id, "insurance");
      const rMid = await made(db, accountId, ana);
      await cleanFile(db, accountId, rMid.id, "insurance");
      await ensureDocumentRequestTask(db, accountId, { requestId: rMid.id, kind: "received", contactId: ana, title: "x", dueAt: now.toISOString() }, "documents-request");
      const rNew = await made(db, accountId, ana);
      await cleanFile(db, accountId, rNew.id, "insurance");
      await ensureDocumentRequestTask(db, accountId, { requestId: rNew.id, kind: "received", contactId: ana, title: "x", dueAt: now.toISOString() }, "documents-request");

      const out = await listRequestsMissingReceivedTask(db, now, 50, { filesPage: 2 });
      // listRequestsMissingReceivedTask reads EVERY account: a parallel test file's own committed,
      // task-less request can legitimately appear in `out` too (fix round 2, point 1). Filtered to
      // THIS test account's own rows, the answer must be exactly the one genuinely missing request.
      const mine = out.filter((r) => r.account_id === accountId);
      expect(mine.map((r) => r.id)).toEqual([rOld.id]);
    }));

  it("the at-most-once send stamp: claim, then a second claim is refused; a clear lets a later claim through (mutation: drop .is('sent_at', null) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      const now = new Date();
      expect(await claimDocumentRequestSend(db, accountId, r.id, now)).toBe(true);
      expect(await claimDocumentRequestSend(db, accountId, r.id, now)).toBe(false);
      await clearDocumentRequestSend(db, accountId, r.id);
      expect((await getDocumentRequest(db, accountId, r.id))?.sent_at).toBeNull();
      expect(await claimDocumentRequestSend(db, accountId, r.id, now)).toBe(true);
    }));
});
