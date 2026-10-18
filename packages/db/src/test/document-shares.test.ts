import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import {
  createDocument, reserveDocumentVersion, markDocumentVersionReady, recordDocumentScan, setDocumentOwnersOnly, trashDocument,
} from "../documents";
import {
  DOCUMENT_SHARE_HOURS, createDocumentShare, findDocumentShareByTokenHash, documentShareState, getShareTarget,
  listLiveDocumentShares, revokeDocumentShares, restoreDocumentShares, claimDocumentShareDownload,
  listReadyVersionScans, shareableVersion, listDocumentShareTimeline, type ReadyVersionScan, type DocumentShareRow,
} from "../document-shares";

/**
 * The share module (0085; spec 4) on the service client (the actions and the public tree hold one
 * AFTER their proof), behind PostgREST on the replica. RLS itself is document-shares-schema.test.ts's job.
 */
const ACTOR = "user_test";
const OTHER = "user_other";
const HOUR = 3_600_000;
/** 64 hex characters from random bytes: letters appear, so an upper-cased hash is a different (refused) value. */
const hash = () => randomBytes(32).toString("hex");
const IP_A = "a".repeat(32);
const IP_B = "b".repeat(32);
const LIMITS: { max: number; windowSeconds: number; linkMax: number } = { max: 5, windowSeconds: 600, linkMax: 100 };

async function readyVersion(db: SupabaseClient, accountId: string, documentId: string, verdict: "clean" | "infected" | null) {
  const r = await reserveDocumentVersion(db, { accountId, documentId, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(r.status);
  expect(await markDocumentVersionReady(db, { accountId, documentId, versionId: r.versionId, bytes: 10, sha256: "a".repeat(64), actorId: ACTOR })).toBe(true);
  if (verdict) await recordDocumentScan(db, { accountId, versionId: r.versionId, verdict });
  return r.versionId;
}
async function cleanDoc(db: SupabaseClient, accountId: string, over: { contactId?: string; ownersOnly?: boolean } = {}) {
  const contactId = over.contactId ?? (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
  const documentId = await createDocument(db, {
    accountId, record: { kind: "contact", id: contactId }, title: "Seguro", category: "insurance", expiresOn: null,
    ownersOnly: over.ownersOnly ?? false, source: "upload", createdBy: ACTOR,
  });
  const versionId = await readyVersion(db, accountId, documentId, "clean");
  return { contactId, documentId, versionId };
}
async function share(
  db: SupabaseClient, accountId: string, d: { documentId: string; versionId: string }, over: { now?: Date; tokenHash?: string } = {},
): Promise<DocumentShareRow> {
  const r = await createDocumentShare(db, {
    accountId, documentId: d.documentId, versionId: d.versionId, tokenHash: over.tokenHash ?? hash(), createdBy: ACTOR,
    ownersOnly: false, now: over.now ?? new Date(),
  });
  if (r.status !== "ok") throw new Error(`share: ${r.status}`);
  return r.share;
}
async function storedShares(db: SupabaseClient, accountId: string, documentId: string) {
  const { data, error } = await db.from("document_shares").select("id").eq("account_id", accountId).eq("document_id", documentId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { id: string }).id);
}

/** [revoked_at as epoch ms (or null), revoked_by] per id, in id order. */
async function revokedPairs(db: SupabaseClient, ids: readonly string[]) {
  const { data, error } = await db.from("document_shares").select("id, revoked_at, revoked_by").in("id", [...ids]).order("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { revoked_at: string | null; revoked_by: string | null }[])
    .map((r) => [r.revoked_at === null ? null : Date.parse(r.revoked_at), r.revoked_by]);
}
/** A client that counts every query started on one table (each from() call) and passes everything through. */
function queriesOn(db: SupabaseClient, table: string) {
  let n = 0;
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (t: string) => { if (t === table) n += 1; return target.from(t); };
    },
  });
  return { db: wrapped, calls: () => n };
}
/** Wraps a query builder so that awaiting it first runs `hook`; every chained call stays wrapped. */
function hooked<T extends object>(b: T, hook: () => Promise<void>): T {
  return new Proxy(b, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (prop === "then") {
        return (ok: (x: unknown) => unknown, bad: (e: unknown) => unknown) =>
          hook().then(() => (target as unknown as PromiseLike<unknown>).then(ok, bad), bad);
      }
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const out = (v as (...a: unknown[]) => unknown).apply(target, args);
        return out !== null && typeof out === "object" ? hooked(out as object, hook) : out;
      };
    },
  });
}
/** A client whose FIRST query on `table` runs `hook` just before it is sent: a write that lands in between. */
function beforeFirstQueryOn(db: SupabaseClient, table: string, hook: () => Promise<void>): SupabaseClient {
  let used = false;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (t: string) => {
        if (t !== table || used) return target.from(t);
        used = true;
        return hooked(target.from(t), hook);
      };
    },
  });
}

describe("document-shares: create and find (spec 4.1)", () => {
  it("stores the hash, expires exactly 24 h on, and finds the row by that hash only (mutation: store tokenHash.toUpperCase() -> the insert FAILS the shape check)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      const tokenHash = hash();
      const s = await share(db, accountId, d, { tokenHash });
      expect(DOCUMENT_SHARE_HOURS).toBe(24);
      expect(Date.parse(s.expires_at) - Date.parse(s.created_at)).toBe(86_400_000);
      expect([s.document_id, s.version_id, s.created_by, s.revoked_at, s.first_opened_at, s.open_count])
        .toEqual([d.documentId, d.versionId, ACTOR, null, null, 0]);
      expect(Object.keys(s)).not.toContain("token_hash");
      expect((await findDocumentShareByTokenHash(db, tokenHash))?.id).toBe(s.id);
      expect(await findDocumentShareByTokenHash(db, hash())).toBeNull();
    }));

  it("refuses to store a share when the document's Owners-only setting is no longer what the action read, and stores nothing (O2 race; mutation: drop the post-insert check -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      // An Owner switched the file to Owners only after the Staff action's read (which saw false).
      expect(await setDocumentOwnersOnly(db, accountId, d.documentId, true)).toBe("updated");
      const r = await createDocumentShare(db, {
        accountId, documentId: d.documentId, versionId: d.versionId, tokenHash: hash(), createdBy: ACTOR, ownersOnly: false, now: new Date(),
      });
      expect(r).toEqual({ status: "changed" });
      expect(await storedShares(db, accountId, d.documentId)).toEqual([]);
      // The value the action read still holds: stored.
      const ok = await createDocumentShare(db, {
        accountId, documentId: d.documentId, versionId: d.versionId, tokenHash: hash(), createdBy: ACTOR, ownersOnly: true, now: new Date(),
      });
      expect(ok.status).toBe("ok");
      if (ok.status !== "ok") return;
      expect(await storedShares(db, accountId, d.documentId)).toEqual([ok.share.id]);
    }));

  it("refuses to store a share of a document that went to the trash after the action's read (mutation: drop .is('deleted_at', null) from the check -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      expect((await trashDocument(db, accountId, d.documentId, ACTOR)).status).toBe("trashed");
      const r = await createDocumentShare(db, {
        accountId, documentId: d.documentId, versionId: d.versionId, tokenHash: hash(), createdBy: ACTOR, ownersOnly: false, now: new Date(),
      });
      expect(r).toEqual({ status: "changed" });
      expect(await storedShares(db, accountId, d.documentId)).toEqual([]);
    }));
});

describe("document-shares: the link's life (pure)", () => {
  it("revoked wins over expired; expires_at <= now is expired; else open (mutation: < for <= -> the boundary case FAILS)", () => {
    const at = "2026-10-20T00:00:00.000Z";
    expect(documentShareState({ revoked_at: at, expires_at: at }, new Date("2026-10-21T00:00:00.000Z"))).toBe("revoked");
    expect(documentShareState({ revoked_at: null, expires_at: at }, new Date(at))).toBe("expired");
    expect(documentShareState({ revoked_at: null, expires_at: at }, new Date("2026-10-21T00:00:00.000Z"))).toBe("expired");
    expect(documentShareState({ revoked_at: null, expires_at: at }, new Date(Date.parse(at) - 1))).toBe("open");
  });
});

describe("document-shares: the shared target (spec 6)", () => {
  it("answers the SHARED version after a newer clean version became current (mutation: read the newest version, not the shared id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      const s = await share(db, accountId, d);
      const v2 = await readyVersion(db, accountId, d.documentId, "clean");
      const { data } = await db.from("documents").select("current_version_id").eq("id", d.documentId).single();
      expect((data as { current_version_id: string }).current_version_id).toBe(v2);
      const t = await getShareTarget(db, s);
      expect(t).toEqual({
        document: { id: d.documentId, title: "Seguro", deleted_at: null },
        version: { id: d.versionId, content_type: "application/pdf", bytes: 10, status: "ready", scan_status: "clean" },
      });
    }));

  it("answers null for another account's ids under this account (mutation: drop .eq('account_id') from BOTH reads -> FAILS)", () =>
    withTestAccount(async (dbB, accountB) =>
      withTestAccount(async (db, accountId) => {
        const theirs = await cleanDoc(dbB, accountB);
        // Real ids from a REAL other account, asked for under this account.
        expect(await getShareTarget(db, { account_id: accountId, document_id: theirs.documentId, version_id: theirs.versionId })).toBeNull();
        expect((await getShareTarget(db, { account_id: accountB, document_id: theirs.documentId, version_id: theirs.versionId }))?.version.id)
          .toBe(theirs.versionId);
      })));

  it("answers null for this version under ANOTHER document of the same account (mutation: drop .eq('document_id') from the version read -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      const other = await cleanDoc(db, accountId, { contactId: d.contactId });
      expect(await getShareTarget(db, { account_id: accountId, document_id: other.documentId, version_id: d.versionId })).toBeNull();
    }));
});

describe("document-shares: the card's live line, stop and undo (spec 4.1; plan deviation 3)", () => {
  it("answers each file's LATER live expiry; revoked, expired and another contact's shares are absent (mutation: drop .is('revoked_at', null) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const now = new Date();
      const d = await cleanDoc(db, accountId);
      const early = await share(db, accountId, d, { now: new Date(now.getTime() - 2 * HOUR) });
      const late = await share(db, accountId, d, { now: new Date(now.getTime() - HOUR) });
      expect(Date.parse(late.expires_at)).toBeGreaterThan(Date.parse(early.expires_at));
      // A second file of the same contact: one revoked share, one expired share, nothing live.
      const quiet = await cleanDoc(db, accountId, { contactId: d.contactId });
      await share(db, accountId, quiet, { now: new Date(now.getTime() - 25 * HOUR) });
      await share(db, accountId, quiet);
      expect((await revokeDocumentShares(db, accountId, quiet.documentId, ACTOR, now))?.ids).toHaveLength(1);
      const theirs = await cleanDoc(db, accountId);
      await share(db, accountId, theirs);
      expect(await listLiveDocumentShares(db, accountId, { kind: "contact", id: d.contactId }, now))
        .toEqual({ [d.documentId]: late.expires_at });
    }));

  it("revokes every live share of THAT document and answers their ids and the stored time; a second call answers null (mutation: drop .eq('document_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const now = new Date();
      const d = await cleanDoc(db, accountId);
      const a = await share(db, accountId, d);
      const b = await share(db, accountId, d);
      const other = await cleanDoc(db, accountId, { contactId: d.contactId });
      const kept = await share(db, accountId, other);
      const r = await revokeDocumentShares(db, accountId, d.documentId, ACTOR, now);
      expect([...r!.ids].sort()).toEqual([a.id, b.id].sort());
      expect(Date.parse(r!.revokedAt)).toBe(now.getTime());
      expect(await revokeDocumentShares(db, accountId, d.documentId, ACTOR, now)).toBeNull();
      const { data } = await db.from("document_shares").select("id, revoked_at").eq("id", kept.id).single();
      expect((data as { revoked_at: string | null }).revoked_at).toBeNull();
    }));

  it("restores exactly that revoke, only the same actor's, only to the millisecond, only while unexpired (mutations: drop .eq('revoked_by'); drop .gt('expires_at') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const now = new Date();
      const d = await cleanDoc(db, accountId);
      await share(db, accountId, d);
      await share(db, accountId, d);
      const r = (await revokeDocumentShares(db, accountId, d.documentId, ACTOR, now))!;
      const base = { accountId, documentId: d.documentId, ids: r.ids, ownersOnly: false, now };
      expect(await restoreDocumentShares(db, { ...base, revokedAt: r.revokedAt, actorId: OTHER })).toEqual({ status: "restored", count: 0 });
      const offByOne = new Date(Date.parse(r.revokedAt) + 1).toISOString();
      expect(await restoreDocumentShares(db, { ...base, revokedAt: offByOne, actorId: ACTOR })).toEqual({ status: "restored", count: 0 });
      expect(await restoreDocumentShares(db, { ...base, revokedAt: r.revokedAt, actorId: ACTOR })).toEqual({ status: "restored", count: 2 });
      expect(Object.keys(await listLiveDocumentShares(db, accountId, { kind: "contact", id: d.contactId }, now))).toEqual([d.documentId]);
      const { data: live } = await db.from("document_shares").select("revoked_at, revoked_by").in("id", r.ids);
      expect(live).toEqual([{ revoked_at: null, revoked_by: null }, { revoked_at: null, revoked_by: null }]);

      // An expired share, revoked by this actor: the Undo never brings it back.
      const old = await share(db, accountId, d, { now: new Date(now.getTime() - 25 * HOUR) });
      const at = new Date(now.getTime() - 24.5 * HOUR).toISOString();
      const { error } = await db.from("document_shares").update({ revoked_at: at, revoked_by: ACTOR }).eq("id", old.id);
      expect(error).toBeNull();
      const { data: stored } = await db.from("document_shares").select("revoked_at").eq("id", old.id).single();
      const storedAt = (stored as { revoked_at: string }).revoked_at;
      expect(await restoreDocumentShares(db, { ...base, ids: [old.id], revokedAt: storedAt, actorId: ACTOR })).toEqual({ status: "restored", count: 0 });
    }));

  it("never brings a link back on a file that went Owners only after Stop sharing, and writes nothing (ruling on concern 4; mutation: drop the check before the restore -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      await share(db, accountId, d);
      await share(db, accountId, d);
      const r = (await revokeDocumentShares(db, accountId, d.documentId, ACTOR, new Date()))!;
      expect(await setDocumentOwnersOnly(db, accountId, d.documentId, true)).toBe("updated");
      const spy = queriesOn(db, "document_shares");
      expect(await restoreDocumentShares(spy.db, {
        accountId, documentId: d.documentId, ids: r.ids, revokedAt: r.revokedAt, actorId: ACTOR, ownersOnly: false, now: new Date(),
      })).toEqual({ status: "changed" });
      // Refused BEFORE any write: the links were never live, not even for a moment.
      expect(spy.calls()).toBe(0);
      const at = Date.parse(r.revokedAt);
      expect(await revokedPairs(db, r.ids)).toEqual([[at, ACTOR], [at, ACTOR]]);
    }));

  it("never brings a link back on a file that went to the trash after Stop sharing (mutation: drop .is('deleted_at', null) from the check -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      await share(db, accountId, d);
      const r = (await revokeDocumentShares(db, accountId, d.documentId, ACTOR, new Date()))!;
      expect((await trashDocument(db, accountId, d.documentId, ACTOR)).status).toBe("trashed");
      expect(await restoreDocumentShares(db, {
        accountId, documentId: d.documentId, ids: r.ids, revokedAt: r.revokedAt, actorId: ACTOR, ownersOnly: false, now: new Date(),
      })).toEqual({ status: "changed" });
      expect(await revokedPairs(db, r.ids)).toEqual([[Date.parse(r.revokedAt), ACTOR]]);
    }));

  it("re-revokes exactly the rows it restored when the file goes Owners only DURING the Undo (the race; mutation: drop the check after the restore -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      await share(db, accountId, d);
      await share(db, accountId, d);
      const r = (await revokeDocumentShares(db, accountId, d.documentId, ACTOR, new Date()))!;
      // The Owner's switch commits after the Undo's first check passed and before its restore is sent.
      const raced = beforeFirstQueryOn(db, "document_shares", async () => {
        expect(await setDocumentOwnersOnly(db, accountId, d.documentId, true)).toBe("updated");
      });
      expect(await restoreDocumentShares(raced, {
        accountId, documentId: d.documentId, ids: r.ids, revokedAt: r.revokedAt, actorId: ACTOR, ownersOnly: false, now: new Date(),
      })).toEqual({ status: "changed" });
      const at = Date.parse(r.revokedAt);
      expect(await revokedPairs(db, r.ids)).toEqual([[at, ACTOR], [at, ACTOR]]);
      expect(await listLiveDocumentShares(db, accountId, { kind: "contact", id: d.contactId }, new Date())).toEqual({});
    }));

  it("restores the links of a file an Owner shared while it was ALREADY Owners only (spec 4.1 lets Owners share such a file; mutation: refuse every Owners-only file -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId, { ownersOnly: true });
      const made = await createDocumentShare(db, {
        accountId, documentId: d.documentId, versionId: d.versionId, tokenHash: hash(), createdBy: ACTOR, ownersOnly: true, now: new Date(),
      });
      expect(made.status).toBe("ok");
      const r = (await revokeDocumentShares(db, accountId, d.documentId, ACTOR, new Date()))!;
      expect(await restoreDocumentShares(db, {
        accountId, documentId: d.documentId, ids: r.ids, revokedAt: r.revokedAt, actorId: ACTOR, ownersOnly: true, now: new Date(),
      })).toEqual({ status: "restored", count: 1 });
      expect(await revokedPairs(db, r.ids)).toEqual([[null, null]]);
    }));
});

describe("document-shares: the download claim (0085; spec 4.2, 4.3)", () => {
  it("answers ok first, then ok not first; closed for a revoked share; throws on an RPC error (mutation: answer first: true always -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      const s = await share(db, accountId, d);
      const claim = (ipHash: string, over: Partial<typeof LIMITS> = {}, shareId = s.id) =>
        claimDocumentShareDownload(db, { accountId, shareId, ipHash, ...LIMITS, ...over });
      expect(await claim(IP_A)).toEqual({ status: "ok", first: true });
      expect(await claim(IP_A)).toEqual({ status: "ok", first: false });
      expect(await claim(IP_A, {}, crypto.randomUUID())).toEqual({ status: "not_found" });
      await expect(claim("nope")).rejects.toThrow("claimDocumentShareDownload failed");
      // 0085 refuses a limit below 1 (22023).
      await expect(claim(IP_A, { max: 0 })).rejects.toThrow("claimDocumentShareDownload failed");
      await revokeDocumentShares(db, accountId, d.documentId, ACTOR, new Date());
      expect(await claim(IP_A)).toEqual({ status: "closed" });
    }));

  it("passes the per-address window: max 1 refuses a second download from the same address (mutation: send p_max: 5 always -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      const s = await share(db, accountId, d);
      const claim = (ipHash: string) => claimDocumentShareDownload(db, { accountId, shareId: s.id, ipHash, ...LIMITS, max: 1 });
      expect(await claim(IP_A)).toEqual({ status: "ok", first: true });
      expect(await claim(IP_A)).toEqual({ status: "rate_limited" });
      expect(await claim(IP_B)).toEqual({ status: "ok", first: false });
    }));

  it("passes the link's total cap: with linkMax 1 a second download from ANOTHER address answers closed (ruling O3; mutation: omit p_link_max -> the RPC errors -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      const s = await share(db, accountId, d);
      const claim = (ipHash: string) => claimDocumentShareDownload(db, { accountId, shareId: s.id, ipHash, ...LIMITS, linkMax: 1 });
      expect(await claim(IP_A)).toEqual({ status: "ok", first: true });
      expect(await claim(IP_B)).toEqual({ status: "closed" });
    }));
});

describe("document-shares: the version a link shares (ruling R-V)", () => {
  const v = (id: string, scan_status: ReadyVersionScan["scan_status"]): ReadyVersionScan => ({ id, scan_status, created_at: "2026-10-18T00:00:00Z" });
  it("is the newest clean version; with none clean the current one decides pending or removed (mutations: always the current version; the OLDEST clean -> FAILS)", () => {
    expect(shareableVersion([v("v2", "clean"), v("v1", "clean")], "v2")).toEqual({ kind: "clean", versionId: "v2" });
    expect(shareableVersion([v("v3", "infected"), v("v1", "clean")], "v3")).toEqual({ kind: "clean", versionId: "v1" });
    expect(shareableVersion([v("v3", "pending"), v("v1", "clean")], "v3")).toEqual({ kind: "clean", versionId: "v1" });
    expect(shareableVersion([v("v1", "pending")], "v1")).toEqual({ kind: "pending" });
    expect(shareableVersion([v("v1", "infected")], "v1")).toEqual({ kind: "removed" });
    expect(shareableVersion([v("v1", "unscannable")], "v1")).toEqual({ kind: "removed" });
    expect(shareableVersion([], null)).toEqual({ kind: "pending" });
  });

  it("listReadyVersionScans answers only READY versions of THAT document, newest first (mutations: drop .eq('status', 'ready'); drop .eq('document_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      const v2 = await readyVersion(db, accountId, d.documentId, null);
      const uploading = await reserveDocumentVersion(db, { accountId, documentId: d.documentId, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      expect(uploading.status).toBe("ok");
      await cleanDoc(db, accountId, { contactId: d.contactId });
      const got = await listReadyVersionScans(db, accountId, d.documentId);
      expect(got.map((r) => [r.id, r.scan_status])).toEqual([[v2, "pending"], [d.versionId, "clean"]]);
    }));
});

describe("document-shares: the timeline's rows (plan deviation 4)", () => {
  it("a share made and opened reads one shares row and one opens row; a share never opened adds a shares row only (mutation: opened() as base() -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const d = await cleanDoc(db, accountId);
      const opened = await share(db, accountId, d);
      const never = await share(db, accountId, d);
      expect(await claimDocumentShareDownload(db, { accountId, shareId: opened.id, ipHash: IP_A, ...LIMITS })).toEqual({ status: "ok", first: true });
      const t = await listDocumentShareTimeline(db, accountId, d.contactId, null, { limit: 31 });
      expect(t.shares.map((r) => r.id).sort()).toEqual([opened.id, never.id].sort());
      expect(t.opens.map((r) => r.id)).toEqual([opened.id]);
      expect(t.opens[0]!.first_opened_at).not.toBeNull();
      expect([t.opens[0]!.title, t.opens[0]!.category, t.opens[0]!.contact_id, t.opens[0]!.created_by]).toEqual(["Seguro", "insurance", d.contactId, ACTOR]);
    }));
});
