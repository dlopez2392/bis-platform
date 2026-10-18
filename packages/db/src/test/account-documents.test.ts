import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember } from "../client-groups";
import { createDocument, reserveDocumentVersion, markDocumentVersionReady, recordDocumentScan } from "../documents";
import { listAccountDocuments, countAccountDocuments, type AccountDocumentsFilter, type AccountDocumentsShow } from "../account-documents";
import { shiftDay } from "../document-rules";

/** The Documents page's read (spec 3.1) on the service client (RLS is 0077's, unchanged; its suites cover it), behind PostgREST. */
const ACTOR = "user_adl_test";
const TODAY = "2030-03-01";
type Opts = { expiresOn: string | null; category?: "insurance" | "photo"; trashed?: boolean; ready?: boolean; group?: string };
async function file(db: SupabaseClient, accountId: string, contactId: string, o: Opts): Promise<string> {
  const id = await createDocument(db, {
    accountId, record: o.group ? { kind: "group", id: o.group } : { kind: "contact", id: contactId }, title: "F",
    category: o.category ?? "insurance", expiresOn: o.expiresOn, ownersOnly: false, source: "upload", createdBy: ACTOR,
  });
  const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(r.status);
  if (o.ready === false) return id;
  expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: 10, sha256: "a".repeat(64), actorId: ACTOR })).toBe(true);
  await recordDocumentScan(db, { accountId, versionId: r.versionId, verdict: "clean" });
  if (o.trashed) {
    const { error } = await db.from("documents").update({ deleted_at: new Date().toISOString(), deleted_by: ACTOR }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  return id;
}
const F = (show: AccountDocumentsShow, category: AccountDocumentsFilter["category"] = null): AccountDocumentsFilter => ({ show, category, today: TODAY });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("listAccountDocuments / countAccountDocuments: the filters' bounds in the account's day (spec 3.1)", () => {
  it("Expiring soon is today..today+30, Expired is before today, All is every live listed file; the count matches each (mutations: lte -> lt, gte -> gt, Expired lte today, drop deleted_at or current_version_id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d0 = await file(db, accountId, ana, { expiresOn: TODAY });
      const d30 = await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, 30) });
      const d31 = await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, 31) });
      const dPast = await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, -1) });
      const dNone = await file(db, accountId, ana, { expiresOn: null });
      await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, 5), trashed: true });
      await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, 5), ready: false });
      const want: Record<AccountDocumentsShow, string[]> = { expiring: [d0, d30], expired: [dPast], all: [d0, d30, d31, dPast, dNone] };
      for (const show of ["expiring", "expired", "all"] as const) {
        const rows = await listAccountDocuments(db, accountId, F(show), { limit: 50 });
        expect(ids(rows).sort(), show).toEqual([...want[show]].sort());
        expect(await countAccountDocuments(db, accountId, F(show)), show).toBe(want[show].length);
      }
    }));

  it("the category filter narrows rows and count alike (mutation: drop the category eq -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ins = await file(db, accountId, ana, { expiresOn: null, category: "insurance" });
      await file(db, accountId, ana, { expiresOn: null, category: "photo" });
      expect(ids(await listAccountDocuments(db, accountId, F("all", "insurance"), { limit: 50 }))).toEqual([ins]);
      expect(await countAccountDocuments(db, accountId, F("all", "insurance"))).toBe(1);
    }));

  it("a household's file carries the group, a customer's the contact (the filed-on link)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", lastName: "García" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa García", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const onGroup = await file(db, accountId, ana, { expiresOn: null, group: g.groupId });
      const onAna = await file(db, accountId, ana, { expiresOn: null });
      const rows = await listAccountDocuments(db, accountId, F("all"), { limit: 50 });
      expect(rows.find((r) => r.id === onGroup)).toMatchObject({ contact: null, group: { id: g.groupId, name: "Casa García", kind: "household" } });
      expect(rows.find((r) => r.id === onAna)).toMatchObject({ group: null, contact: { id: ana, first_name: "Ana", last_name: "García" } });
    }));
});

describe("listAccountDocuments: the order and the cursor round-trip (spec 3.1 Sort, Paging)", () => {
  it.each([
    ["expiring", "expires_on ascending, then id"],
    ["expired", "expires_on descending, then id"],
    ["all", "created_at descending, then id"],
  ] as const)("%s pages through every row exactly once in its order (%s) (mutations: the cursor's gt/lt as gte/lte -> a row twice; the id tiebreak the wrong way -> FAILS)", (show, _order) =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const days = show === "expired" ? [-1, -1, -3, -2, -2] : [3, 3, 1, 2, 2];
      for (const d of days) await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, d) });
      const whole = await listAccountDocuments(db, accountId, F(show), { limit: 50 });
      expect(whole).toHaveLength(5);
      const paged: string[] = [];
      let before: { v: string; id: string } | undefined;
      for (let page = 0; page < 5; page++) {
        const rows = await listAccountDocuments(db, accountId, F(show), { limit: 2, before });
        paged.push(...ids(rows));
        if (rows.length < 2) break;
        const last = rows[rows.length - 1]!;
        before = { v: show === "all" ? last.created_at : last.expires_on!, id: last.id };
      }
      expect(paged).toEqual(ids(whole));
      const keys = whole.map((r) => (show === "all" ? r.created_at : r.expires_on!));
      const sorted = [...keys].sort();
      expect(keys).toEqual(show === "expiring" ? sorted : sorted.reverse());
    }));

  it("all: two files with the SAME created_at page across one at a time, by id descending (review: distinct created_at could not fail the tiebreak; mutation: drop the and() id branch -> a file is skipped -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await file(db, accountId, ana, { expiresOn: null });
      const b = await file(db, accountId, ana, { expiresOn: null });
      await file(db, accountId, ana, { expiresOn: null });
      const { data, error } = await db.from("documents").update({ created_at: "2001-01-01T00:00:00.123456+00:00" })
        .in("id", [a, b]).select("id");
      if (error) throw new Error(error.message);
      expect(data).toHaveLength(2);
      const whole = await listAccountDocuments(db, accountId, F("all"), { limit: 50 });
      expect(whole).toHaveLength(3);
      expect(ids(whole.slice(1))).toEqual([a, b].sort().reverse());
      const paged: string[] = [];
      let before: { v: string; id: string } | undefined;
      for (let page = 0; page < 5; page++) {
        const rows = await listAccountDocuments(db, accountId, F("all"), { limit: 1, before });
        paged.push(...ids(rows));
        if (rows.length < 1) break;
        before = { v: rows[0]!.created_at, id: rows[0]!.id };
      }
      expect(paged).toEqual(ids(whole));
    }));

  it("a cursor that does not fit the list is refused, never sent to the database (mutation: skip the check -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await expect(listAccountDocuments(db, accountId, F("expiring"), { limit: 2, before: { v: "2030-03-01T00:00:00Z", id: crypto.randomUUID() } })).rejects.toThrow(TypeError);
      await expect(listAccountDocuments(db, accountId, F("all"), { limit: 2, before: { v: "2030-03-01", id: "x" } })).rejects.toThrow(TypeError);
    }));

  it("an impossible day is refused as a cursor that does not fit, before the database (review minor; mutation: the DAY regex alone -> Postgres answers a plain Error -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      for (const show of ["expiring", "expired"] as const) {
        await expect(listAccountDocuments(db, accountId, F(show), { limit: 2, before: { v: "2030-02-31", id: crypto.randomUUID() } }), show).rejects.toThrow(TypeError);
      }
    }));
});

describe("countAccountDocuments: a null count is a failure, never zero (memory head-count null)", () => {
  it("throws on {count: null, error: null} (mutation: count ?? 0 -> FAILS)", async () => {
    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "gte", "lte", "lt", "or", "order", "limit", "match"]) b[k] = () => b;
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: null }).then(ok, bad);
    const fake = { from: () => b } as unknown as SupabaseClient;
    await expect(countAccountDocuments(fake, "acct", F("all"))).rejects.toThrow("no count");
  });
});
