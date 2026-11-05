import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChangeGroup, ChangeRow } from "./record-changes";
import { changeNameRefs, readChangeNames } from "./record-change-names";

const AT = "2026-11-05T00:00:00.000Z";
const row = (over: Partial<ChangeRow>): ChangeRow => ({
  id: 1, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
  op: "update", field: "phone", before: "a", after: "b", xact: "1",
  authorKind: "person", authorId: "user_1", via: null, createdAt: AT,
  ...over,
});
const group = (rows: ChangeRow[], over: Partial<ChangeGroup> = {}): ChangeGroup => ({
  key: "k", recordType: rows[0]!.recordType, recordId: rows[0]!.recordId, authorKind: "person", authorId: "user_1",
  via: null, at: AT, firstAt: AT, steps: [rows], rows, ...over,
});

describe("changeNameRefs (pure): what one page's groups reference", () => {
  it("a removed relationship's related_contact_id (mutation: read before.contact_id instead -> FAILS, collects the wrong id)", () => {
    const g = group([row({
      recordType: "contact_relationship", op: "delete", field: null,
      before: { contact_id: "owner-1", related_contact_id: "other-9" }, after: null,
    })], { recordType: "contact_relationship" });
    expect([...changeNameRefs([g]).contactIds]).toEqual(["other-9"]);
  });

  it("an updated related_contact_id, both before and after (mutation: read only `after` -> FAILS, missing the before id)", () => {
    const g = group([row({ recordType: "contact_relationship", field: "related_contact_id", before: "old-1", after: "new-2" })]);
    expect([...changeNameRefs([g]).contactIds].sort()).toEqual(["new-2", "old-1"]);
  });

  it("a removed place's contact_id and client_group_id (mutation: drop the client_group_id collection -> FAILS)", () => {
    const g = group([row({
      recordType: "place", op: "delete", field: null,
      before: { contact_id: "c9", client_group_id: "g9" }, after: null,
    })], { recordType: "place" });
    const refs = changeNameRefs([g]);
    expect([...refs.contactIds]).toEqual(["c9"]);
    expect([...refs.groupIds]).toEqual(["g9"]);
  });

  it("a removed tag's own record id (mutation: collect row.contactId instead of row.recordId -> FAILS)", () => {
    const g = group([row({
      recordType: "contact_tag", recordId: "tag-7", contactId: "ct-1", op: "delete", field: null, before: null, after: null,
    })], { recordType: "contact_tag" });
    expect([...changeNameRefs([g]).tagIds]).toEqual(["tag-7"]);
  });

  // F-115 PR E fix round 2 (review I7, partial): an ADDED tag's own id too (`insertVerb`'s "added the
  // tag {name}" needs it, same reasoning as the removal verb's own read).
  it("an added tag's own record id, from an insert (mutation: collect only on delete -> FAILS on insert)", () => {
    const g = group([row({
      recordType: "contact_tag", recordId: "tag-9", contactId: "ct-1", op: "insert", field: null, before: null, after: {},
    })], { recordType: "contact_tag" });
    expect([...changeNameRefs([g]).tagIds]).toEqual(["tag-9"]);
  });

  it("every client_group_member row's own group id, any op (mutation: only collect on delete -> FAILS on an update)", () => {
    const g = group([row({ recordType: "client_group_member", clientGroupId: "g5", field: "role", before: "a", after: "b" })]);
    expect([...changeNameRefs([g]).groupIds]).toEqual(["g5"]);
  });

  // F-115 PR E fix round 2 (review I4, partial): a member's own CONTACT id, not just their group's —
  // collected on EVERY op (an insert is "added Ana", a delete is "removed Ana", an update moves the
  // SAME member), so a REMOVED member — no longer in the group's own activity set — still reads by
  // name on both the customer's own page and the group's.
  it("every client_group_member row's own contact id, on EVERY op — insert, update and delete (mutation: collect only on delete -> FAILS on insert/update)", () => {
    const inserted = group([row({ recordType: "client_group_member", contactId: "ana-1", clientGroupId: "g1", op: "insert", field: null, before: null, after: { role: "member" } })]);
    expect([...changeNameRefs([inserted]).contactIds]).toEqual(["ana-1"]);
    const updated = group([row({ recordType: "client_group_member", contactId: "ana-1", clientGroupId: "g1", field: "role", before: "a", after: "b" })]);
    expect([...changeNameRefs([updated]).contactIds]).toEqual(["ana-1"]);
    const deleted = group([row({ recordType: "client_group_member", contactId: "ana-1", clientGroupId: "g1", op: "delete", field: null, before: { role: "member" }, after: null })], { recordType: "client_group_member" });
    expect([...changeNameRefs([deleted]).contactIds]).toEqual(["ana-1"]);
  });

  // F-115 PR E fix round 2 (review I4, partial): an INSERTED relationship names who it points at too
  // (insertVerb's own "added the link to {name}") — only `after.related_contact_id` exists on an insert.
  it("an inserted relationship's own related_contact_id, from `after` (mutation: read only on delete/update, skip insert -> FAILS)", () => {
    const g = group([row({
      recordType: "contact_relationship", op: "insert", field: null,
      before: null, after: { contact_id: "owner-1", related_contact_id: "other-9" },
    })], { recordType: "contact_relationship" });
    expect([...changeNameRefs([g]).contactIds]).toEqual(["other-9"]);
  });

  it("an equipment unit's replaces_id, a deal's stage_id and pipeline_id (mutation: swap stageIds and pipelineIds -> FAILS)", () => {
    const equipmentGroup = group([row({ recordType: "equipment", field: "replaces_id", before: null, after: "unit-old" })], { recordType: "equipment" });
    const dealGroup = group([
      row({ id: 2, recordType: "opportunity", field: "stage_id", before: "stage-a", after: "stage-b" }),
      row({ id: 3, recordType: "opportunity", field: "pipeline_id", before: "pipe-a", after: "pipe-b" }),
    ], { recordType: "opportunity" });
    const refs = changeNameRefs([equipmentGroup, dealGroup]);
    expect([...refs.equipmentIds]).toEqual(["unit-old"]);
    expect([...refs.stageIds].sort()).toEqual(["stage-a", "stage-b"]);
    expect([...refs.pipelineIds].sort()).toEqual(["pipe-a", "pipe-b"]);
  });

  it("an empty page asks for nothing", () => {
    const refs = changeNameRefs([]);
    expect(refs.contactIds.size + refs.groupIds.size + refs.tagIds.size + refs.equipmentIds.size + refs.stageIds.size + refs.pipelineIds.size).toBe(0);
  });
});

/**
 * A FLAT row set per table, each row carrying its OWN `account_id` — filters are applied generically,
 * exactly as called (`.eq`, `.in`), with NO partitioning baked in ahead of time. This is deliberate:
 * a table-partitioned-by-account fake would make "drop the .eq('account_id', …) call" an UNDETECTABLE
 * mutation (the fake's own partitioning would still exclude the other account's row even with the real
 * filter missing) — the exact kind of vacuous test this project's own history warns about. Here, a
 * dropped `account_id` filter genuinely leaks the other account's row, because nothing else in this
 * fake stops it.
 */
function fakeNamesDb(rows: Partial<Record<string, Record<string, unknown>[]>>) {
  const calls: { table: string; eq: Record<string, unknown>; limit: number | null }[] = [];
  const builder = (table: string, eq: Record<string, unknown>, inFilter: { col: string; vals: unknown[] } | null, limit: number | null) => {
    const b: Record<string, (...a: unknown[]) => unknown> = {};
    b.select = () => b;
    b.eq = (c: unknown, v: unknown) => builder(table, { ...eq, [c as string]: v }, inFilter, limit);
    b.in = (c: unknown, v: unknown) => builder(table, eq, { col: c as string, vals: v as unknown[] }, limit);
    // F-115 PR E fix round 2 (review n6): every names read now carries an explicit `.limit(n)` —
    // recorded here so a test can prove it is bounded by the id SET's own size, never an unbounded read.
    b.limit = (n: unknown) => builder(table, eq, inFilter, n as number);
    b.then = (...a: unknown[]) => {
      const resolve = a[0] as (v: unknown) => unknown;
      calls.push({ table, eq, limit });
      const data = (rows[table] ?? []).filter((r) =>
        Object.entries(eq).every(([c, v]) => r[c] === v)
        && (!inFilter || (inFilter.vals as unknown[]).includes(r[inFilter.col])));
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return b;
  };
  const db = { from: (table: string) => builder(table, {}, null, null) } as unknown as SupabaseClient;
  return { db, calls };
}

const NO_REFS = { contactIds: new Set<string>(), groupIds: new Set<string>(), tagIds: new Set<string>(), equipmentIds: new Set<string>(), stageIds: new Set<string>(), pipelineIds: new Set<string>() };

describe("readChangeNames: bounded, account-scoped reads (review I4)", () => {
  it("resolves a contact's name, a tag's name, a group's kind, an equipment unit's name, a stage's name and a pipeline's name, each filtered to the caller's own account (mutation: drop the .eq('account_id', …) call on the contacts table -> the 'never resolves' test below FAILS, the other account's contact leaks in)", async () => {
    const { db, calls } = fakeNamesDb({
      contacts: [{ id: "c9", account_id: "a1", first_name: "Ana", last_name: "García" }],
      client_groups: [{ id: "g9", account_id: "a1", kind: "business" }],
      tags: [{ id: "tag-7", account_id: "a1", name: "VIP" }],
      equipment: [{ id: "unit-old", account_id: "a1", name: "Carrier AC" }],
      pipeline_stages: [{ id: "stage-a", account_id: "a1", name: "Quoted" }],
      pipelines: [{ id: "pipe-a", account_id: "a1", name: "Install jobs" }],
    });
    const refs = {
      contactIds: new Set(["c9"]), groupIds: new Set(["g9"]), tagIds: new Set(["tag-7"]),
      equipmentIds: new Set(["unit-old"]), stageIds: new Set(["stage-a"]), pipelineIds: new Set(["pipe-a"]),
    };
    const result = await readChangeNames(db, "a1", refs);
    expect(result.names).toEqual({ c9: "Ana García", "tag-7": "VIP", "unit-old": "Carrier AC", "stage-a": "Quoted", "pipe-a": "Install jobs" });
    expect(result.groupKinds).toEqual({ g9: "business" });
    for (const table of ["contacts", "client_groups", "tags", "equipment", "pipeline_stages", "pipelines"]) {
      expect(calls.some((c) => c.table === table && c.eq.account_id === "a1"), `${table} was called with .eq("account_id", "a1")`).toBe(true);
    }
  });

  // F-115 PR E fix round 2 (review n6): each read is bounded by its OWN id set's size, never an
  // unbounded scan — each ref set here has a different size (1, 2, 1, 1, 1, 1) so a copy-paste that
  // reused the WRONG set's size would be caught.
  it("every read carries an explicit .limit(), bounded by the id set it was asked for (mutation: omit .limit() entirely -> FAILS, the recorded limit is null)", async () => {
    const { db, calls } = fakeNamesDb({});
    const refs = {
      contactIds: new Set(["c1", "c2"]), groupIds: new Set(["g1"]), tagIds: new Set(["t1"]),
      equipmentIds: new Set(["e1"]), stageIds: new Set(["s1"]), pipelineIds: new Set(["p1"]),
    };
    await readChangeNames(db, "a1", refs);
    const limitOf = (table: string) => calls.find((c) => c.table === table)?.limit;
    expect(limitOf("contacts")).toBe(2);
    expect(limitOf("client_groups")).toBe(1);
    expect(limitOf("tags")).toBe(1);
    expect(limitOf("equipment")).toBe(1);
    expect(limitOf("pipeline_stages")).toBe(1);
    expect(limitOf("pipelines")).toBe(1);
  });

  it("an id that exists only in ANOTHER account never resolves — a FLAT row set (no pre-partitioning), so this genuinely exercises the .eq('account_id', …) filter rather than relying on test-fixture isolation (mutation: drop that one .eq call in readChangeNames's contacts query -> FAILS, names.c9 becomes 'Leaked Name')", async () => {
    const { db } = fakeNamesDb({ contacts: [{ id: "c9", account_id: "a2", first_name: "Leaked", last_name: "Name" }] });
    const result = await readChangeNames(db, "a1", { ...NO_REFS, contactIds: new Set(["c9"]) });
    expect(result.names).toEqual({});
  });

  it("an empty ref set reads nothing at all (mutation: always query every table -> FAILS, calls would be non-empty)", async () => {
    const { db, calls } = fakeNamesDb({});
    const result = await readChangeNames(db, "a1", NO_REFS);
    expect(result).toEqual({ names: {}, groupKinds: {} });
    expect(calls).toEqual([]);
  });

  it("a blank or missing name is left out, never an empty-string entry (mutation: always set names[c.id] even when blank -> FAILS)", async () => {
    const { db } = fakeNamesDb({ contacts: [{ id: "c1", account_id: "a1", first_name: null, last_name: null }] });
    const result = await readChangeNames(db, "a1", { ...NO_REFS, contactIds: new Set(["c1"]) });
    expect(result.names).toEqual({});
  });
});
