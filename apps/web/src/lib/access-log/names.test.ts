import { describe, expect, it } from "vitest";
import type { AccessLogItem, AccessLogPage, SupabaseClient } from "@bis/db";
import { NAME_CHUNK, resolveAccessLogNames } from "./names";

/**
 * F-118 part 1 (plan Task 4, step 3). A fake client that records every `from(table).select(cols)
 * .eq(col, val).in(col, ids)` it was asked for, and answers per table — the `view-reads.test.ts` shape.
 */
/** `rows` (instead of `data`) makes the stand-in APPLY the read's eq / in / is filters to those rows, the way
 *  PostgREST would (`ai-summary-inputs.test.ts`'s `applyFilters`), so a second account's row with a matching id
 *  is answered only when the read forgot its account fence. */
type Answer = { data?: unknown[]; rows?: Record<string, unknown>[]; error?: { message: string } };
type Read = { table: string; cols: string; eq: [string, unknown][]; in: [string, unknown[]][]; is: [string, unknown][] };

function applyFilters(rows: Record<string, unknown>[], read: Read): Record<string, unknown>[] {
  return rows.filter((row) =>
    read.eq.every(([col, v]) => !(col in row) || row[col] === v)
    && read.is.every(([col, v]) => !(col in row) || row[col] === v)
    && read.in.every(([col, vs]) => !(col in row) || vs.includes(row[col])));
}

function fakeDb(answers: Partial<Record<string, Answer | ((read: Read) => Answer)>>) {
  const reads: Read[] = [];
  const client = {
    from(table: string) {
      const read: Read = { table, cols: "", eq: [], in: [], is: [] };
      reads.push(read);
      const settle = async () => {
        const a = answers[table];
        const res = typeof a === "function" ? a(read) : (a ?? { data: [] });
        const data = res.rows ? applyFilters(res.rows, read) : res.data;
        return { data: data ?? null, error: res.error ?? null };
      };
      const chain = {
        select(cols: string) { read.cols = cols; return chain; },
        eq(col: string, v: unknown) { read.eq.push([col, v]); return chain; },
        in(col: string, v: unknown[]) { read.in.push([col, v]); return chain; },
        is(col: string, v: unknown) { read.is.push([col, v]); return chain; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return settle().then(res, rej); },
      };
      return chain;
    },
  };
  return { db: client as unknown as SupabaseClient, reads };
}

const item = (over: Partial<AccessLogItem>): AccessLogItem =>
  ({ kind: "contact", recordId: null, itemCount: null, firstOpenedAt: "2026-10-29T19:00:00Z", ...over });

const pageOf = (items: AccessLogItem[]): AccessLogPage => ({
  total: 1, hasOlder: false,
  visits: [{ id: "visit_1", actorName: "Dan Lopez", reason: "support", startedAt: "2026-10-29T19:00:00Z", endedAt: null,
    counts: { contact: 0, group: 0, call: 0, conversation: 0, file: 0, form_answers: 0, customer_list_export: 0 },
    itemTotal: items.length, items }],
});

const A = "11111111-1111-1111-1111-111111111111";

describe("resolveAccessLogNames", () => {
  it("only THIS account's rows are resolved: a second account's row with a matching id never is, in any of the six tables (agency RLS is not account-scoped, so .eq('account_id') is the only fence; mutation: drop it -> FAILS naming the table)", async () => {
    const page = pageOf([
      item({ kind: "contact", recordId: "c_mine" }), item({ kind: "contact", recordId: "c_other" }),
      item({ kind: "group", recordId: "g_mine" }), item({ kind: "group", recordId: "g_other" }),
      item({ kind: "call", recordId: "call_mine" }), item({ kind: "call", recordId: "call_other" }),
      item({ kind: "conversation", recordId: "conv_mine" }), item({ kind: "conversation", recordId: "conv_other" }),
      item({ kind: "document_view", recordId: "doc_mine" }), item({ kind: "document_view", recordId: "doc_other" }),
      item({ kind: "form_answers", recordId: "form_mine" }), item({ kind: "form_answers", recordId: "form_other" }),
    ]);
    const B = "22222222-2222-2222-2222-222222222222";
    const doc = { title: "W-9", deleted_at: null, contact_id: null, client_group_id: null };
    const { db } = fakeDb({
      contacts: { rows: [
        { account_id: A, id: "c_mine", first_name: "Ana", last_name: "Ruiz", archived_at: null },
        { account_id: B, id: "c_other", first_name: "Other", last_name: "Person", archived_at: null },
      ] },
      client_groups: { rows: [
        { account_id: A, id: "g_mine", name: "The Smiths", kind: "household" },
        { account_id: B, id: "g_other", name: "Other House", kind: "household" },
      ] },
      calls: { rows: [
        { account_id: A, id: "call_mine", started_at: "2026-10-28T20:04:00Z", contact_id: null },
        { account_id: B, id: "call_other", started_at: "2026-10-28T20:04:00Z", contact_id: null },
      ] },
      conversations: { rows: [{ account_id: A, id: "conv_mine", contact_id: null }, { account_id: B, id: "conv_other", contact_id: null }] },
      documents: { rows: [{ account_id: A, id: "doc_mine", ...doc }, { account_id: B, id: "doc_other", ...doc }] },
      forms: { rows: [{ account_id: A, id: "form_mine", name: "Contact us" }, { account_id: B, id: "form_other", name: "Other form" }] },
    });
    const names = await resolveAccessLogNames(db, A, page);
    const tables = {
      contacts: names.contacts, client_groups: names.groups, calls: names.calls,
      conversations: names.conversations, documents: names.documents, forms: names.forms,
    };
    for (const [table, map] of Object.entries(tables)) {
      expect([...map.keys()].map((k) => k.replace(/^[a-z]+_/, "")), table).toEqual(["mine"]);
    }
  });

  it("the contacts read includes the contact ids found on the calls and conversations, so a call's caller has a name", async () => {
    const page = pageOf([
      item({ kind: "call", recordId: "call1" }),
      item({ kind: "conversation", recordId: "conv1" }),
    ]);
    const { db, reads } = fakeDb({
      calls: { data: [{ id: "call1", started_at: "2026-10-28T20:04:00Z", contact_id: "con_from_call" }] },
      conversations: { data: [{ id: "conv1", contact_id: "con_from_conv" }] },
    });
    await resolveAccessLogNames(db, A, page);
    const contactReads = reads.filter((r) => r.table === "contacts");
    expect(contactReads).toHaveLength(1);
    expect(contactReads[0]!.in).toEqual([["id", expect.arrayContaining(["con_from_call", "con_from_conv"])]]);
  });

  it("120 contact ids make three reads of at most NAME_CHUNK (50) (mutation: one unchunked call -> FAILS)", async () => {
    expect(NAME_CHUNK).toBe(50);
    const items = Array.from({ length: 120 }, (_, i) => item({ kind: "contact", recordId: `c${i}` }));
    const page = pageOf(items);
    const { db, reads } = fakeDb({});
    await resolveAccessLogNames(db, A, page);
    const contactReads = reads.filter((r) => r.table === "contacts");
    expect(contactReads).toHaveLength(3);
    expect(contactReads.map((r) => r.in[0]![1].length)).toEqual([50, 50, 20]);
  });

  it("no ids of a kind means no read of that table", async () => {
    const page = pageOf([item({ kind: "contact", recordId: "c1" })]);
    const { db, reads } = fakeDb({});
    await resolveAccessLogNames(db, A, page);
    const tables = reads.map((r) => r.table);
    expect(tables).not.toContain("client_groups");
    expect(tables).not.toContain("calls");
    expect(tables).not.toContain("conversations");
    expect(tables).not.toContain("documents");
    expect(tables).not.toContain("forms");
  });

  it("a read error throws, naming the table (mutation: swallow it into empty maps -> FAILS)", async () => {
    const page = pageOf([item({ kind: "group", recordId: "g1" })]);
    const { db } = fakeDb({ client_groups: { error: { message: "groups down" } } });
    await expect(resolveAccessLogNames(db, A, page)).rejects.toThrow(/client_groups/);
  });

  it("trashed documents and archived contacts are NOT filtered out — no .is() is ever chained (mutation: add .is('deleted_at', null) -> FAILS on the trashed fixture)", async () => {
    const page = pageOf([
      item({ kind: "contact", recordId: "c1" }),
      item({ kind: "document_view", recordId: "doc1" }),
    ]);
    const { db, reads } = fakeDb({
      contacts: { data: [{ id: "c1", first_name: "Maria", last_name: "Lopez", archived_at: "2026-01-01T00:00:00Z" }] },
      documents: { data: [{ id: "doc1", title: "Insurance card", deleted_at: "2026-01-02T00:00:00Z", contact_id: "c1", client_group_id: null }] },
    });
    const names = await resolveAccessLogNames(db, A, page);
    expect(reads.filter((r) => r.table === "contacts" || r.table === "documents").every((r) => r.is.length === 0)).toBe(true);
    expect(names.contacts.get("c1")).toEqual({ first: "Maria", last: "Lopez", archived: true });
    expect(names.documents.get("doc1")).toEqual({ title: "Insurance card", trashed: true, record: { kind: "contact", id: "c1" } });
  });

  it("builds the forms, groups and documents maps from their own rows, a group file by its own record", async () => {
    const page = pageOf([
      item({ kind: "group", recordId: "g1" }),
      item({ kind: "form_answers", recordId: "form1" }),
      item({ kind: "document_share", recordId: "doc2" }),
    ]);
    const { db } = fakeDb({
      client_groups: { data: [{ id: "g1", name: "Rio Roofing", kind: "business" }] },
      forms: { data: [{ id: "form1", name: "Contact us" }] },
      documents: { data: [{ id: "doc2", title: "Lease", deleted_at: null, contact_id: null, client_group_id: "g1" }] },
    });
    const names = await resolveAccessLogNames(db, A, page);
    expect(names.groups.get("g1")).toEqual({ name: "Rio Roofing", kind: "business" });
    expect(names.forms.get("form1")).toEqual({ name: "Contact us" });
    expect(names.documents.get("doc2")).toEqual({ title: "Lease", trashed: false, record: { kind: "group", id: "g1" } });
  });
});
