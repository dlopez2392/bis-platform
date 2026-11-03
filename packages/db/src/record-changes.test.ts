import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  groupChanges, foldVia, COLLAPSE_MINUTES, changeRowBeforeFilter, encodeChangeCursorId, decodeChangeCursorId,
  listChangeRows, listChangeRowsNoPartialWrite, type ChangeRow, type ChangeGroup,
} from "./record-changes";

/**
 * F-115 part 1 (S-04), Task 4: `groupChanges`/`foldVia` are pure (no Supabase variable; see
 * `listChangeRows`'s own impure tests via the RLS/schema suites that exercise it live).
 */
let nextId = 1;
function row(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id: nextId++, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
    op: "update", field: "phone", before: "a", after: "b", xact: "100",
    authorKind: "person", authorId: "user_1", via: null, createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function group(over: Partial<ChangeGroup> = {}): ChangeGroup {
  const r = row();
  return {
    key: "k1", recordType: "contact", recordId: "c1", authorKind: "person", authorId: "user_1",
    via: null, at: r.createdAt, firstAt: r.createdAt, steps: [[r]], rows: [r], ...over,
  };
}

describe("groupChanges", () => {
  it("rows sharing one xact and record form one group; a different xact is a different group, even at the identical instant (mutation: group by createdAt -> FAILS on two writes in the same second)", () => {
    const sameWrite = [
      row({ id: 1, field: "phone", xact: "100", createdAt: "2026-01-01T00:00:00.500Z" }),
      row({ id: 2, field: "email", xact: "100", createdAt: "2026-01-01T00:00:00.500Z" }),
    ];
    const grouped = groupChanges(sameWrite);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.rows).toHaveLength(2);

    // Two DIFFERENT writes (different xact), the exact same instant, but different authors so the
    // separate collapse rule (tested below) cannot be the reason they stay apart: only the xact-based
    // write key can be. A buggy implementation keyed on createdAt alone would merge these into one.
    const twoWrites = [
      row({ id: 3, xact: "200", authorKind: "person", authorId: "user_1", createdAt: "2026-01-01T00:00:00.500Z" }),
      row({ id: 4, xact: "201", authorKind: "ai", authorId: null, createdAt: "2026-01-01T00:00:00.500Z" }),
    ];
    expect(groupChanges(twoWrites)).toHaveLength(2);
  });

  it("two writes by the same author on the same record collapse into one group within 10 minutes, and stay two past it (mutation: compare with <= 11 -> FAILS)", () => {
    const near = [
      row({ id: 1, xact: "1", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: 2, xact: "2", createdAt: "2026-01-01T00:09:00.000Z" }), // 9 minutes later
    ];
    const nearGroups = groupChanges(near);
    expect(nearGroups).toHaveLength(1);
    expect(nearGroups[0]!.steps).toHaveLength(2);

    const far = [
      row({ id: 3, xact: "3", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: 4, xact: "4", createdAt: "2026-01-01T00:11:00.000Z" }), // 11 minutes later
    ];
    expect(groupChanges(far)).toHaveLength(2);
  });

  it("COLLAPSE_MINUTES is 10", () => {
    expect(COLLAPSE_MINUTES).toBe(10);
  });

  it("a different author, or a different record, never collapses even seconds apart", () => {
    const differentAuthor = [
      row({ id: 1, xact: "1", authorKind: "person", authorId: "user_1", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: 2, xact: "2", authorKind: "person", authorId: "user_2", createdAt: "2026-01-01T00:00:01.000Z" }),
    ];
    expect(groupChanges(differentAuthor)).toHaveLength(2);

    const differentRecord = [
      row({ id: 3, xact: "1", recordId: "c1", contactId: "c1", createdAt: "2026-01-01T00:00:00.000Z" }),
      row({ id: 4, xact: "2", recordId: "c2", contactId: "c2", createdAt: "2026-01-01T00:00:01.000Z" }),
    ];
    expect(groupChanges(differentRecord)).toHaveLength(2);
  });

  it("a group with no author (observe mode) is kept, not dropped", () => {
    const rows = [row({ authorKind: null, authorId: null })];
    const groups = groupChanges(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.authorKind).toBeNull();
  });
});

describe("foldVia", () => {
  it("drops a merge/ai_act/proposal group only when its id is already on this page; keeps it when the referenced row is not on the page (mutation: drop the onPage check -> FAILS)", () => {
    const onPage = { mergeIds: new Set(["7"]), aiActIds: new Set(["a1"]), proposalIds: new Set(["p1"]) };
    const mergeOnPage = group({ key: "m", via: "merge:7" });
    const mergeNotOnPage = group({ key: "m2", via: "merge:9" });
    const aiActOnPage = group({ key: "a", via: "ai_act:a1" });
    const aiActNotOnPage = group({ key: "a2", via: "ai_act:a9" });
    const proposalOnPage = group({ key: "p", via: "proposal:p1" });
    const plain = group({ key: "x", via: null });

    const kept = foldVia([mergeOnPage, mergeNotOnPage, aiActOnPage, aiActNotOnPage, proposalOnPage, plain], onPage);
    expect(kept.map((g) => g.key)).toEqual(["m2", "a2", "x"]);
  });

  it("never folds a restore: group, even one a client could have forged, because there is no restoreIds set to prove it against (mutation: fold restore too -> FAILS)", () => {
    const onPage = { mergeIds: new Set<string>(), aiActIds: new Set<string>(), proposalIds: new Set<string>() };
    const forgedRestore = group({ key: "r", via: "restore:999" });
    expect(foldVia([forgedRestore], onPage).map((g) => g.key)).toEqual(["r"]);
  });

  it("keeps a group with no author (observe mode) through the fold", () => {
    const onPage = { mergeIds: new Set<string>(), aiActIds: new Set<string>(), proposalIds: new Set<string>() };
    const noAuthor = group({ key: "n", via: null, authorKind: null, authorId: null });
    expect(foldVia([noAuthor], onPage).map((g) => g.key)).toEqual(["n"]);
  });
});

/**
 * F-115 PR C fix (review C1): the same `col.lt.v OR (col.eq.v AND id.lt.n)` idiom
 * `timelineBeforeFilter` (timeline-cursor.ts) already uses for a UUID id, but for `record_changes`'s
 * own bigint `id` — never quoted/lowered the way a uuid is, just validated as a safe positive integer.
 */
describe("changeRowBeforeFilter: strictly past (created_at, id), the bigint-id twin of timelineBeforeFilter", () => {
  it("is exactly `col.lt.v OR (col.eq.v AND id.lt.n)`, quoted on the timestamp only (mutation: drop the and(...) half -> FAILS)", () => {
    expect(changeRowBeforeFilter("created_at", { createdAt: "2026-11-02T00:00:03.500000+00:00", id: 42 })).toBe(
      `created_at.lt."2026-11-02T00:00:03.500000+00:00",and(created_at.eq."2026-11-02T00:00:03.500000+00:00",id.lt.42)`);
  });

  it("throws on a non-positive or non-safe-integer id: it never reaches a filter string (mutation: drop the check -> FAILS)", () => {
    expect(() => changeRowBeforeFilter("created_at", { createdAt: "2026-11-02T00:00:00Z", id: 0 })).toThrow(TypeError);
    expect(() => changeRowBeforeFilter("created_at", { createdAt: "2026-11-02T00:00:00Z", id: -1 })).toThrow(TypeError);
    expect(() => changeRowBeforeFilter("created_at", { createdAt: "2026-11-02T00:00:00Z", id: 1.5 })).toThrow(TypeError);
  });
});

/**
 * F-115 PR C fix (review I2): the "change" timeline entry's own `id` must survive
 * `parseTimelineCursor`/`timelineBeforeFilter` (both require a UUID-shaped string) even though
 * `record_changes.id` is a plain bigint — so it travels as a zero-padded 32-hex-digit, dashed string
 * (always UUID-shaped) that still sorts, as a lowercase-hex STRING, in the same order as the integer.
 */
describe("encodeChangeCursorId / decodeChangeCursorId: a bigint id in UUID-cursor clothing", () => {
  it("encodes to the 8-4-4-4-12 shape parseTimelineCursor's UUID regex accepts", () => {
    const id = encodeChangeCursorId(123);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).toBe("00000000-0000-0000-0000-00000000007b");
  });

  it("round-trips through decode (mutation: decode via a non-zero-padded parseInt alone, skipping the round-trip check -> still passes here, but a wrong-width string would then silently decode; this pins the exact encoding instead)", () => {
    for (const n of [1, 2, 9, 10, 99, 100, 123456789]) {
      expect(decodeChangeCursorId(encodeChangeCursorId(n))).toBe(n);
    }
  });

  it("preserves numeric order as STRING order (fixed-width zero padding): id 9 sorts before id 10 as a string too (mutation: hex without zero-padding -> FAILS, '9' > '10' as text)", () => {
    const a = encodeChangeCursorId(9);
    const b = encodeChangeCursorId(10);
    expect(a < b).toBe(true);
  });

  it("decodes null for a real random UUID (practically always: a 128-bit random value is virtually never a safe integer) (mutation: drop Number.isSafeInteger -> a real uuid would decode to a huge bigint 'id', FAILS)", () => {
    expect(decodeChangeCursorId("9f86d081-884c-7d65-9a2f-eaf0135e2b3c")).toBeNull();
  });

  it("decodes null for garbage", () => {
    expect(decodeChangeCursorId("not-a-uuid")).toBeNull();
    expect(decodeChangeCursorId("")).toBeNull();
  });
});

/**
 * F-115 PR C fix (review I2): `listChangeRows` branches on whether its cursor's own `id` is present —
 * the `(created_at, id)` OR idiom when it is (a row this module itself produced earlier), a plain
 * `created_at <` bound when it is not (`record.ts`'s only external seed without one: the outer
 * merged-timeline cursor, when the previous page's cutoff was not itself a "change" entry).
 */
describe("listChangeRows: the cursor's own branch (with id vs. without)", () => {
  function recordingDb() {
    const calls: { method: string; args: unknown[] }[] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    const rec = (method: string) => (...a: unknown[]) => { calls.push({ method, args: a }); return chain; };
    for (const m of ["select", "eq", "in", "or", "lt", "order"]) chain[m] = rec(m);
    chain.limit = async (..._a: unknown[]) => ({ data: [], error: null });
    const db = { from: () => chain } as unknown as SupabaseClient;
    return { db, calls };
  }

  it("with id: calls .or with the (created_at, id) filter, never .lt (mutation: always call .lt -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await listChangeRows(db, "a1", { contactIds: ["c1"] }, { createdAt: "2026-11-02T00:00:00Z", id: 5 }, 10);
    expect(calls.some((c) => c.method === "or" && c.args[0] === changeRowBeforeFilter("created_at", { createdAt: "2026-11-02T00:00:00Z", id: 5 }))).toBe(true);
    expect(calls.some((c) => c.method === "lt")).toBe(false);
  });

  it("without id: calls .lt on created_at alone, never .or (mutation: always call .or -> FAILS, since changeRowBeforeFilter would throw with no id)", async () => {
    const { db, calls } = recordingDb();
    await listChangeRows(db, "a1", { contactIds: ["c1"] }, { createdAt: "2026-11-02T00:00:00Z" }, 10);
    expect(calls.some((c) => c.method === "lt" && c.args[0] === "created_at" && c.args[1] === "2026-11-02T00:00:00Z")).toBe(true);
    expect(calls.some((c) => c.method === "or")).toBe(false);
  });

  it("no cursor at all: neither .or nor .lt (a cold start)", async () => {
    const { db, calls } = recordingDb();
    await listChangeRows(db, "a1", { contactIds: ["c1"] }, undefined, 10);
    expect(calls.some((c) => c.method === "or" || c.method === "lt")).toBe(false);
  });
});

/**
 * F-115 PR C fix (review C1/I2): a REAL (if minimal) `record_changes`-shaped fake — `.eq`/`.in` filter
 * an in-memory row set, `.or` parses the EXACT `changeRowBeforeFilter` idiom and applies it, `.lt`
 * applies a plain bound, and `.limit` sorts (created_at desc, id desc) before slicing — so a test can
 * prove the ACTUAL paging behaviour across several `listChangeRows` calls, not just one call's own
 * filter string.
 */
function fakeChangesDb(rows: readonly ChangeRow[], accountId = "a1") {
  type Filters = { eq: [string, unknown][]; in: [string, unknown[]][]; or: string | null; lt: [string, unknown] | null };
  const raw = (r: ChangeRow) => ({
    id: r.id, account_id: accountId, record_type: r.recordType, record_id: r.recordId, contact_id: r.contactId,
    client_group_id: r.clientGroupId, op: r.op, field: r.field, before: r.before, after: r.after, xact: r.xact,
    author_kind: r.authorKind, author_id: r.authorId, via: r.via, created_at: r.createdAt,
  } as Record<string, unknown>);
  function builder(filters: Filters) {
    const b: Record<string, (...a: unknown[]) => unknown> = {};
    b.select = () => b;
    b.eq = (c: unknown, v: unknown) => builder({ ...filters, eq: [...filters.eq, [c as string, v]] });
    b.in = (c: unknown, v: unknown) => builder({ ...filters, in: [...filters.in, [c as string, v as unknown[]]] });
    b.or = (s: unknown) => builder({ ...filters, or: s as string });
    b.lt = (c: unknown, v: unknown) => builder({ ...filters, lt: [c as string, v] });
    b.order = () => b;
    b.limit = async (n: unknown) => {
      let result = rows.map(raw).filter((r) =>
        filters.eq.every(([c, v]) => r[c] === v) && filters.in.every(([c, vs]) => (vs as unknown[]).includes(r[c])));
      if (filters.lt) {
        const [c, v] = filters.lt;
        result = result.filter((r) => (r[c] as string) < (v as string));
      }
      if (filters.or) {
        const m = /^created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.(\d+)\)$/.exec(filters.or);
        if (!m) throw new Error(`fakeChangesDb: unrecognised .or filter: ${filters.or}`);
        const [, ltV, eqV, idStr] = m as unknown as [string, string, string, string];
        const idBound = Number(idStr);
        result = result.filter((r) => (r.created_at as string) < ltV || ((r.created_at as string) === eqV && (r.id as number) < idBound));
      }
      result = [...result].sort((a, c) => {
        if (a.created_at !== c.created_at) return (a.created_at as string) < (c.created_at as string) ? 1 : -1;
        return (c.id as number) - (a.id as number);
      });
      return { data: result.slice(0, n as number), error: null };
    };
    return b;
  }
  const db = { from: () => builder({ eq: [], in: [], or: null, lt: null }) };
  return db as unknown as SupabaseClient;
}

describe("listChangeRowsNoPartialWrite: never cuts a write across the internal page boundary (C1/I2)", () => {
  it("3 rows sharing one instant, page size 2, returns all 3 exactly once (mutation: a createdAt-only cursor between internal pages would FAIL this)", async () => {
    const T = "2026-11-02T00:00:00.500000+00:00";
    const mk = (id: number, field: string): ChangeRow => ({
      id, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
      op: "update", field, before: "x", after: "y", xact: "1",
      authorKind: "person", authorId: "u1", via: null, createdAt: T,
    });
    const db = fakeChangesDb([mk(3, "a"), mk(2, "b"), mk(1, "c")]); // desc by id, as the real table orders
    const result = await listChangeRowsNoPartialWrite(db, "a1", { contactIds: ["c1"] }, undefined, 2, 2);
    expect(result.rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(result.hasMore).toBe(false); // nothing older exists at all
  });

  it("stops at a real page boundary (a strictly older instant), never over-reading, and reports hasMore (mutation: absorb every row regardless of instant -> FAILS)", async () => {
    const T1 = "2026-11-02T00:00:00.500000+00:00";
    const T0 = "2026-11-01T00:00:00.000000+00:00";
    const mk = (id: number, createdAt: string): ChangeRow => ({
      id, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
      op: "update", field: "a", before: "x", after: "y", xact: String(id),
      authorKind: "person", authorId: "u1", via: null, createdAt,
    });
    const db = fakeChangesDb([mk(3, T1), mk(2, T1), mk(1, T0)]);
    const result = await listChangeRowsNoPartialWrite(db, "a1", { contactIds: ["c1"] }, undefined, 2, 2);
    expect(result.rows.map((r) => r.id)).toEqual([3, 2]); // id 1 (the older instant) stays for the NEXT page
    // F-115 PR C fix (review I2): `hasMore` is the signal record.ts needs to still name an Older
    // cursor when the collapsed GROUP count alone would not prove it (mutation: hard-code hasMore
    // false -> FAILS, since id 1 genuinely remains unread here).
    expect(result.hasMore).toBe(true);
  });

  it("hasMore is false when the probe finds truly nothing left (mutation: hard-code hasMore true -> FAILS)", async () => {
    const T = "2026-11-02T00:00:00.500000+00:00";
    const mk = (id: number): ChangeRow => ({
      id, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
      op: "update", field: "a", before: "x", after: "y", xact: "1",
      authorKind: "person", authorId: "u1", via: null, createdAt: T,
    });
    const db = fakeChangesDb([mk(2), mk(1)]);
    const result = await listChangeRowsNoPartialWrite(db, "a1", { contactIds: ["c1"] }, undefined, 2, 2);
    expect(result.rows.map((r) => r.id)).toEqual([2, 1]);
    expect(result.hasMore).toBe(false);
  });
});
