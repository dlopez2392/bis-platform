import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTimelinePage, type TimelineEntry } from "./record";
import { decodeChangeCursorId } from "./record-changes";

/**
 * F-115 PR C fix (review I2): `listTimelinePage`'s `changes` source, across a real page boundary —
 * a fake db that answers EVERY table except `record_changes` with empty results (a universal
 * chainable proxy; every other source genuinely reads nothing), and `record_changes` with REAL
 * `(created_at, id)` filtering identical to the production query's own shape, so a regression in how
 * the cursor is built or consumed shows up here exactly as it would against Postgres.
 *
 * `opts.changes` stays dormant in the app's own loaders (I2's orchestrator ruling) — this file proves
 * the SOURCE itself, independent of that dormancy, since PR E turns it on and must inherit it correct.
 */

type RawRow = {
  id: number; account_id: string; record_type: string; record_id: string; contact_id: string | null;
  client_group_id: string | null; op: string; field: string | null; before: unknown; after: unknown;
  xact: number; author_kind: string | null; author_id: string | null; via: string | null; created_at: string;
};

/** Matches ANY chain a source might build (`.select().eq().in().not().order().limit()`, …) and
 *  resolves to an empty, error-free result however it is finally consumed (`await`ed directly, or via
 *  `.maybeSingle()`/`.single()`). Good enough for every source besides `record_changes`, which this
 *  test suite reads nothing from, because every OTHER table here is genuinely empty. */
function emptyChain(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
      if (prop === "catch" || prop === "finally") return undefined; // not a real promise; never actually called this way here
      return (..._args: unknown[]) => proxy;
    },
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy;
}

type RecordChangesFilters = { eq: [string, unknown][]; in: [string, unknown[]][]; or: string | null; lt: [string, unknown] | null };

function recordChangesChain(rows: readonly RawRow[], filters: RecordChangesFilters): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "select") return () => recordChangesChain(rows, filters);
      if (prop === "eq") return (c: string, v: unknown) => recordChangesChain(rows, { ...filters, eq: [...filters.eq, [c, v]] });
      if (prop === "in") return (c: string, v: unknown[]) => recordChangesChain(rows, { ...filters, in: [...filters.in, [c, v]] });
      if (prop === "or") return (s: string) => recordChangesChain(rows, { ...filters, or: s });
      // F-115 PR E fix round 2 (re-review I1): `listChangeRows` reverted to `.or(changeRowBeforeFilter(...))`
      // once it has a real row's own (createdAt, id) pair; `.lt("id", …)` is never called with one any
      // more (see record-changes.ts's own doc comment on why — case (e)'s id/time divergence). `.lt`
      // on `created_at` ALONE is still the cold-start branch (no id yet), so it stays supported here.
      if (prop === "lt") return (c: string, v: unknown) => recordChangesChain(rows, { ...filters, lt: [c, v] });
      if (prop === "order") return () => recordChangesChain(rows, filters);
      if (prop === "limit") {
        return (n: number) => {
          let result = rows.filter((r) =>
            filters.eq.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v)
            && filters.in.every(([c, vs]) => vs.includes((r as unknown as Record<string, unknown>)[c])));
          if (filters.or) {
            const m = /^created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.(\d+)\)$/.exec(filters.or);
            if (!m) throw new Error(`unrecognised .or filter: ${filters.or}`);
            const [, ltV, eqV, idStr] = m as unknown as [string, string, string, string];
            const idBound = Number(idStr);
            result = result.filter((r) => r.created_at < ltV || (r.created_at === eqV && r.id < idBound));
          }
          if (filters.lt) {
            const [c, v] = filters.lt;
            result = result.filter((r) => {
              const field = (r as unknown as Record<string, unknown>)[c];
              return typeof field === "number" && typeof v === "number" ? field < v
                : typeof field === "string" && typeof v === "string" ? field < v
                : false;
            });
          }
          result = [...result].sort((a, b) => (a.created_at === b.created_at ? b.id - a.id : (a.created_at < b.created_at ? 1 : -1)));
          return Promise.resolve({ data: result.slice(0, n), error: null });
        };
      }
      return (..._a: unknown[]) => recordChangesChain(rows, filters);
    },
  };
  return new Proxy({}, handler);
}

/** F-115 PR E fix round 2 (re-review I1, cases c4/c5): a MINIMAL, real "notes" table — exactly what
 *  `listNotes` needs (`.eq`/`.in` filters, then `.limit`) — so a foreign entry (a different source
 *  entirely, never a `record_changes` row) can sit at a real instant on the merged timeline. Never
 *  itself cursor-aware (`.or` is accepted and ignored): every test here keeps the notes source small
 *  enough that it never needs a second page of its own, which is never the thing under test. */
type NoteRow = { id: string; account_id: string; contact_id: string; body: string; pinned: boolean; author_id: string | null; created_at: string };
function notesChain(rows: readonly NoteRow[], filters: { eq: [string, unknown][]; in: [string, unknown[]][] }): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "select") return () => notesChain(rows, filters);
      if (prop === "eq") return (c: string, v: unknown) => notesChain(rows, { ...filters, eq: [...filters.eq, [c, v]] });
      if (prop === "in") return (c: string, v: unknown[]) => notesChain(rows, { ...filters, in: [...filters.in, [c, v]] });
      if (prop === "or") return () => notesChain(rows, filters);
      if (prop === "order") return () => notesChain(rows, filters);
      if (prop === "limit") {
        return (n: number) => {
          const result = rows.filter((r) =>
            filters.eq.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v)
            && filters.in.every(([c, vs]) => vs.includes((r as unknown as Record<string, unknown>)[c])));
          return Promise.resolve({ data: result.slice(0, n), error: null });
        };
      }
      return (..._a: unknown[]) => notesChain(rows, filters);
    },
  };
  return new Proxy({}, handler);
}

function fakeDb(rows: readonly RawRow[], notes: readonly NoteRow[] = []): SupabaseClient {
  return {
    from: (table: string) => (
      table === "record_changes" ? recordChangesChain(rows, { eq: [], in: [], or: null, lt: null })
        : table === "notes" ? notesChain(notes, { eq: [], in: [] })
          : emptyChain()
    ),
  } as unknown as SupabaseClient;
}

function row(over: Partial<RawRow>): RawRow {
  return {
    id: 1, account_id: "a1", record_type: "contact", record_id: "c1", contact_id: "c1", client_group_id: null,
    op: "update", field: "phone", before: "x", after: "y", xact: 1,
    author_kind: "person", author_id: "user_1", via: null, created_at: "2026-11-02T00:00:00.500000+00:00",
    ...over,
  };
}

describe("listTimelinePage({ changes: true }): a write split across a page boundary (review I2)", () => {
  const TA = "2026-11-02T00:00:00.500000+00:00"; // write A: 3 rows, one instant, one xact, one author
  const TB = "2026-10-20T00:00:00.000000+00:00"; // write B: 1 row, an older instant, a DIFFERENT author (no collapse)
  const rows: RawRow[] = [
    row({ id: 5, field: "first_name", xact: 10, created_at: TA, author_id: "user_1" }),
    row({ id: 4, field: "last_name", xact: 10, created_at: TA, author_id: "user_1" }),
    row({ id: 3, field: "email", xact: 10, created_at: TA, author_id: "user_1" }),
    row({ id: 1, field: "phone", xact: 20, created_at: TB, author_id: "user_2" }),
  ];

  it("page 1 shows write A COMPLETE (all 3 fields), never cut, and names an Older cursor", async () => {
    const db = fakeDb(rows);
    const page = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 1 });
    expect(page.failed).toEqual([]);
    expect(page.items).toHaveLength(1);
    const entry = page.items[0]!;
    expect(entry.kind).toBe("change");
    if (entry.kind !== "change") throw new Error("unreachable");
    expect(entry.group.rows.map((r) => r.field).sort()).toEqual(["email", "first_name", "last_name"]);
    expect(page.older).not.toBeNull();
  });

  it("the Older cursor's id survives decodeChangeCursorId (parseTimelineCursor's own UUID check, in spirit)", async () => {
    const db = fakeDb(rows);
    const page = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 1 });
    const cursor = page.older!;
    expect(decodeChangeCursorId(cursor.id)).not.toBeNull();
  });

  it("page 2, from page 1's Older cursor, shows write B — never re-showing any of write A's rows (mutation: cursor the group's MAX row id instead of its MIN -> FAILS, duplicating ids 4 and 3)", async () => {
    const db = fakeDb(rows);
    const page1 = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 1 });
    const page2 = await listTimelinePage(db, "a1", ["c1"], page1.older!, { changes: true, limit: 1 });
    expect(page2.failed).toEqual([]);
    expect(page2.items).toHaveLength(1);
    const entry = page2.items[0]!;
    expect(entry.kind).toBe("change");
    if (entry.kind !== "change") throw new Error("unreachable");
    expect(entry.group.rows.map((r) => r.id)).toEqual([1]);
    expect(page2.older).toBeNull(); // write B was the last of the scope
  });
});

/**
 * F-115 PR E fix (review I1): a FOLDED group (several WRITES, not one) that is the LAST item shown on
 * a page builds its cursor from the group's `at` (its NEWEST step) paired with the group's MINIMUM row
 * id (its OLDEST step) — two different rows once a group spans more than one write. The bug: the next
 * page's `created_at < at` half of the old filter re-admitted the group's own OLDER step on its own,
 * because that step's `created_at` genuinely IS less than the group's newest instant. `id < minId`
 * (review I1's fix) has no such mismatch, because every row of the already-shown group has `id >=
 * minId` by construction.
 */
describe("listTimelinePage({ changes: true }): a folded group as the last item never repeats on the next page (review I1)", () => {
  const T1 = "2026-11-02T00:00:00.000000+00:00"; // GroupW: oldest, standalone, unread until page 2
  const T2 = "2026-11-02T00:05:00.000000+00:00"; // GroupY step 1 (5 min before T3: folds with it)
  const T3 = "2026-11-02T00:10:00.000000+00:00"; // GroupY step 2 (its newest -> the group's own `at`)
  const T5 = "2026-11-02T00:20:00.000000+00:00"; // GroupX: newest overall, standalone
  const rows: RawRow[] = [
    row({ id: 5, record_id: "cx", contact_id: "cx", author_id: "user_x", created_at: T5, xact: 50, field: "source" }),
    row({ id: 3, record_id: "cy", contact_id: "cy", author_id: "user_y", created_at: T3, xact: 30, field: "last_name" }),
    row({ id: 2, record_id: "cy", contact_id: "cy", author_id: "user_y", created_at: T2, xact: 20, field: "first_name" }),
    row({ id: 1, record_id: "cw", contact_id: "cw", author_id: "user_w", created_at: T1, xact: 10, field: "email" }),
  ];
  const CONTACTS = ["cx", "cy", "cw"];

  it("page 1 shows GroupX then the folded GroupY (both its steps); page 2 shows ONLY GroupW, never GroupY's rows again (mutation: pair the cursor's id with the group's own `at` instead of its oldest row's own time -> FAILS, id 2 or 3 reappear)", async () => {
    const db = fakeDb(rows);
    const page1 = await listTimelinePage(db, "a1", CONTACTS, undefined, { changes: true, limit: 2 });
    expect(page1.failed).toEqual([]);
    expect(page1.items).toHaveLength(2);
    const [first, second] = page1.items;
    if (first!.kind !== "change" || second!.kind !== "change") throw new Error("unreachable");
    expect(first!.group.rows.map((r) => r.id)).toEqual([5]);
    expect(second!.group.rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([2, 3]); // GroupY, both steps
    expect(second!.group.steps).toHaveLength(2);
    expect(page1.older).not.toBeNull();

    const page2 = await listTimelinePage(db, "a1", CONTACTS, page1.older!, { changes: true, limit: 2 });
    expect(page2.failed).toEqual([]);
    const allPage2Ids = page2.items.flatMap((e) => (e.kind === "change" ? e.group.rows.map((r) => r.id) : []));
    expect(allPage2Ids).toEqual([1]); // GroupW only — ids 2 and 3 never reappear
    expect(page2.older).toBeNull();
  });
});

/**
 * F-115 PR E fix (review I1): the inverse risk — a page's own row-level read quota can land BETWEEN
 * two steps that groupChanges would otherwise fold together (one step read, kept off `items` by the
 * overall limit; its partner not read at all yet). The fix must not LOSE the unread step either: every
 * row appears in the combined output of every page, exactly once, whether or not the two steps end up
 * folded into one row together.
 */
describe("listTimelinePage({ changes: true }): a page boundary landing between a group's own two steps loses nothing (review I1)", () => {
  const T1 = "2026-11-02T00:00:00.000000+00:00"; // GroupY step 1 (9 min before T2: folds with it)
  const T2 = "2026-11-02T00:09:00.000000+00:00"; // GroupY step 2
  const T3 = "2026-11-02T00:20:00.000000+00:00"; // GroupZ: newest, standalone — the only thing limit:1 shows on page 1
  const rows: RawRow[] = [
    row({ id: 3, record_id: "cz", contact_id: "cz", author_id: "user_z", created_at: T3, xact: 30, field: "source" }),
    row({ id: 2, record_id: "cy", contact_id: "cy", author_id: "user_y", created_at: T2, xact: 20, field: "email" }),
    row({ id: 1, record_id: "cy", contact_id: "cy", author_id: "user_y", created_at: T1, xact: 10, field: "phone" }),
  ];
  const CONTACTS = ["cz", "cy"];

  it("neither step is lost nor duplicated across the two pages (mutation: drop the id<n read extension that recovers id 2 -> FAILS, id 2 never appears anywhere)", async () => {
    const db = fakeDb(rows);
    const page1 = await listTimelinePage(db, "a1", CONTACTS, undefined, { changes: true, limit: 1 });
    expect(page1.items).toHaveLength(1);
    const first = page1.items[0]!;
    if (first.kind !== "change") throw new Error("unreachable");
    expect(first.group.rows.map((r) => r.id)).toEqual([3]); // GroupZ only; GroupY's lone-read step is cut by the limit
    expect(page1.older).not.toBeNull();

    const page2 = await listTimelinePage(db, "a1", CONTACTS, page1.older!, { changes: true, limit: 1 });
    expect(page2.failed).toEqual([]);
    const page2Ids = page2.items.flatMap((e) => (e.kind === "change" ? e.group.rows.map((r) => r.id) : []));
    expect(page2Ids.sort((a, b) => a - b)).toEqual([1, 2]); // both of GroupY's own steps, each exactly once
    expect(page2.older).toBeNull();
  });
});

/**
 * F-115 PR E fix (review I3): the group page reads `record_changes` twice — once scoped to every
 * member's own `contact_id` (`loadGroupTimeline`'s own id set), once scoped to the group's own
 * `client_group_id` — and a `client_group_member` row carries BOTH columns (0112's capture), so a
 * membership edit comes back in BOTH reads and reached `groupChanges` twice, doubling its Was/Now
 * line and binding "Put back" to the same row from two different buttons.
 */
describe("listTimelinePage({ changes: true, groupId }): a client_group_member row is never read twice (review I3)", () => {
  it("one row scoped to BOTH the member's contact id and the group's own id appears exactly once (mutation: drop the dedup before groupChanges -> FAILS, group.rows has it twice)", async () => {
    const T = "2026-11-02T00:00:00.000000+00:00";
    const rows: RawRow[] = [
      row({
        id: 9, record_type: "client_group_member", record_id: "m1", contact_id: "member-1", client_group_id: "group-1",
        author_id: "user_1", created_at: T, xact: 90, field: "role",
      }),
    ];
    const db = fakeDb(rows);
    const page = await listTimelinePage(db, "a1", ["member-1"], undefined, { changes: true, limit: 5, groupId: "group-1" });
    expect(page.failed).toEqual([]);
    expect(page.items).toHaveLength(1);
    const entry = page.items[0]!;
    if (entry.kind !== "change") throw new Error("unreachable");
    expect(entry.group.rows).toHaveLength(1);
    expect(entry.group.rows[0]!.id).toBe(9);
  });
});

/**
 * F-115 PR C fix (review m2): a rejection from the raw "changes" read resolves to `failed: ["changes"]`
 * and `onError("changes", …)`, never an uncaught/unhandled rejection — the `.catch` is attached at
 * promise CREATION (before the later `await`), the same guarantee every other source already gets
 * from `settle`'s try/catch running inside an immediately-invoked async function. If it were attached
 * only at the later `await`, Node would report an `unhandledRejection` in the gap between creation and
 * that `await`; this test cannot observe THAT event directly, but it does prove the read's failure
 * still reaches `onError`/`failed` through the exact same `.then().catch()` chain production uses.
 */
describe("listTimelinePage({ changes: true }): a failed raw read never throws, never unhandled (review m2)", () => {
  function throwingDb(): SupabaseClient {
    return {
      from: (table: string) => {
        if (table !== "record_changes") return emptyChain();
        const handler: ProxyHandler<object> = {
          get(_t, prop) {
            if (prop === "limit") return () => Promise.reject(new Error("record_changes read boom"));
            return (..._a: unknown[]) => new Proxy({}, handler);
          },
        };
        return new Proxy({}, handler);
      },
    } as unknown as SupabaseClient;
  }

  it("a thrown/rejected changes read reports failed: ['changes'] and calls onError, resolving normally (mutation: drop the .catch at creation -> an unhandledRejection would surface instead)", async () => {
    const onError = vi.fn();
    const page = await listTimelinePage(throwingDb(), "a1", ["c1"], undefined, { changes: true, limit: 5, onError });
    expect(page.failed).toEqual(["changes"]);
    expect(onError).toHaveBeenCalledWith("changes", expect.anything());
    expect(page.items).toEqual([]);
  });
});

/**
 * F-115 PR E fix round 2 (re-review I1): the full case list the second review walked `listTimelinePage`
 * page by page with. Each is named for the letter it answers; every one must fail BY NAME against
 * either the id-only cursor (`listChangeRows`'s old `.lt("id", …)`) or against folding across a
 * foreign entry (`groupChanges` with no contiguity check) — this file's own mutation-by-name discipline.
 */
function note(over: Partial<NoteRow>): NoteRow {
  return { id: "n1", account_id: "a1", contact_id: "c1", body: "x", pinned: false, author_id: "user_n", created_at: "2026-11-02T00:00:00.000000+00:00", ...over };
}

describe("listTimelinePage({ changes: true }): the full re-review case list (round 2, I1)", () => {
  // (a) baseline: two adjacent writes with NOTHING between them still fold, exactly as before —
  // proves the contiguity check is additive, not a regression on the ordinary case.
  it("(a) nothing between two adjacent same-author writes: they still fold into one group", async () => {
    const T1 = "2026-11-02T00:00:00.000000+00:00";
    const T2 = "2026-11-02T00:05:00.000000+00:00";
    const rows: RawRow[] = [
      row({ id: 2, xact: 2, created_at: T2, field: "last_name" }),
      row({ id: 1, xact: 1, created_at: T1, field: "first_name" }),
    ];
    const db = fakeDb(rows);
    const page = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 5 });
    expect(page.items).toHaveLength(1);
    const entry = page.items[0]!;
    if (entry.kind !== "change") throw new Error("unreachable");
    expect(entry.group.steps).toHaveLength(2);
  });

  // (b) "cut between a group's steps with another record's row in between, limit 2": record cr's
  // two writes would fold (same author, 5 min apart) but record cx's OWN write sits chronologically
  // between them — a DIFFERENT record's change row, not a foreign source. They must NOT fold, and
  // paging across all three (limit 2) must neither duplicate nor skip any of the three.
  it("(b) another record's own row between two of THIS record's writes splits them, never folds, across a limit:2 page boundary (mutation: groupChanges with no foreignAtMs -> FAILS, cr's two writes wrongly fold into one)", async () => {
    const T1 = "2026-11-02T00:00:00.000000+00:00"; // cr write 1 (oldest)
    const T2 = "2026-11-02T00:03:00.000000+00:00"; // cx write (between)
    const T3 = "2026-11-02T00:05:00.000000+00:00"; // cr write 2 (newest)
    const rows: RawRow[] = [
      row({ id: 3, record_id: "cr", contact_id: "cr", author_id: "user_r", created_at: T3, xact: 3, field: "last_name" }),
      row({ id: 2, record_id: "cx", contact_id: "cx", author_id: "user_x", created_at: T2, xact: 2, field: "source" }),
      row({ id: 1, record_id: "cr", contact_id: "cr", author_id: "user_r", created_at: T1, xact: 1, field: "first_name" }),
    ];
    const db = fakeDb(rows);
    const page1 = await listTimelinePage(db, "a1", ["cr", "cx"], undefined, { changes: true, limit: 2 });
    expect(page1.items).toHaveLength(2);
    const [newest, second] = page1.items;
    if (newest!.kind !== "change" || second!.kind !== "change") throw new Error("unreachable");
    expect(newest!.group.rows.map((r) => r.id)).toEqual([3]); // cr write 2, alone — never folded with write 1
    expect(second!.group.rows.map((r) => r.id)).toEqual([2]); // cx's own write
    expect(page1.older).not.toBeNull();

    const page2 = await listTimelinePage(db, "a1", ["cr", "cx"], page1.older!, { changes: true, limit: 2 });
    const page2Ids = page2.items.flatMap((e) => (e.kind === "change" ? e.group.rows.map((r) => r.id) : []));
    expect(page2Ids).toEqual([1]); // cr write 1, exactly once — never duplicated, never skipped
    expect(page2.older).toBeNull();
  });

  // (b2) is the existing describe block just above ("a page boundary landing between a group's own
  // two steps loses nothing") — kept there rather than duplicated here; it already pins exactly this.

  // (c2/c3): a THREE-step group, with `limit:1` (so the raw read itself, bounded by
  // `listChangeRowsNoPartialWrite`'s own pageSize, only reaches 2 of the 3 steps this call) — the
  // group-spans-more-than-one-EXTERNAL-page case the original (c2) duplication bug and its (c3)
  // extension both generalise to: DESIGN.md's own "may split, never duplicate or skip" per step id.
  it("(c2/c3) a 3-step group split by the raw read's own row-count limit: page 1 folds 2 of its 3 steps, page 2 the last one, never duplicated nor skipped (mutation: cursor the newest step's own `at` -> FAILS, step 1 repeats or step 2/3 vanish)", async () => {
    const T1 = "2026-11-02T00:00:00.000000+00:00";
    const T2 = "2026-11-02T00:03:00.000000+00:00";
    const T3 = "2026-11-02T00:06:00.000000+00:00";
    const rows: RawRow[] = [
      row({ id: 3, created_at: T3, xact: 3, field: "email" }),
      row({ id: 2, created_at: T2, xact: 2, field: "last_name" }),
      row({ id: 1, created_at: T1, xact: 1, field: "first_name" }),
    ];
    const db = fakeDb(rows);
    const page1 = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 1 });
    expect(page1.items).toHaveLength(1);
    const entry = page1.items[0]!;
    if (entry.kind !== "change") throw new Error("unreachable");
    expect(entry.group.rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([2, 3]);
    expect(page1.older).not.toBeNull();

    const page2 = await listTimelinePage(db, "a1", ["c1"], page1.older!, { changes: true, limit: 1 });
    expect(page2.items).toHaveLength(1);
    const entry2 = page2.items[0]!;
    if (entry2.kind !== "change") throw new Error("unreachable");
    expect(entry2.group.rows.map((r) => r.id)).toEqual([1]); // the last step, exactly once
    expect(page2.older).toBeNull();
  });

  // (c4) "same-instant note+change": a note and a change row share the EXACT same instant. Neither
  // duplicates nor crashes; the foreign-instant check treats an EXACT match as a tie, never "between".
  it("(c4) a note at the exact same instant as a single-step change: both show, neither duplicates across pages (mutation: >= instead of > in hasBetween -> the change would wrongly split from itself, FAILS)", async () => {
    const T = "2026-11-02T00:00:00.000000+00:00";
    const rows: RawRow[] = [row({ id: 1, created_at: T, xact: 1 })];
    const notes: NoteRow[] = [note({ id: "n1", created_at: T })];
    const db = fakeDb(rows, notes);
    const page = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 5 });
    expect(page.items).toHaveLength(2);
    const change = page.items.find((e) => e.kind === "change");
    expect(change).toBeDefined();
    if (change!.kind !== "change") throw new Error("unreachable");
    expect(change!.group.rows.map((r) => r.id)).toEqual([1]);
  });

  // (c5) "folded group then a note as last item at a time inside the group's span": a note's own
  // instant falls strictly BETWEEN two writes that would otherwise fold — they must split, the note
  // becomes its own entry between them, and paging across all three loses and duplicates nothing.
  it("(c5) a note strictly between two otherwise-foldable writes splits them; paging shows all three exactly once (mutation: ignore non-change sources' entries in foreignAtMs -> FAILS, the two writes wrongly fold, hiding the split)", async () => {
    const T1 = "2026-11-02T00:00:00.000000+00:00"; // write 1 (oldest)
    const T2 = "2026-11-02T00:03:00.000000+00:00"; // the note (between)
    const T3 = "2026-11-02T00:05:00.000000+00:00"; // write 2 (newest)
    const rows: RawRow[] = [
      row({ id: 2, created_at: T3, xact: 2, field: "last_name" }),
      row({ id: 1, created_at: T1, xact: 1, field: "first_name" }),
    ];
    const notes: NoteRow[] = [note({ id: "n1", created_at: T2 })];
    const db = fakeDb(rows, notes);
    const page1 = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 2 });
    expect(page1.items).toHaveLength(2);
    const [newest, second] = page1.items;
    expect(newest!.kind).toBe("change");
    if (newest!.kind !== "change") throw new Error("unreachable");
    expect(newest!.group.rows.map((r) => r.id)).toEqual([2]); // write 2, alone (split from write 1)
    expect(second!.kind).toBe("note"); // the note sits between them in the merged order
    expect(page1.older).not.toBeNull();

    const page2 = await listTimelinePage(db, "a1", ["c1"], page1.older!, { changes: true, limit: 2 });
    const page2ChangeIds = page2.items.flatMap((e) => (e.kind === "change" ? e.group.rows.map((r) => r.id) : []));
    expect(page2ChangeIds).toEqual([1]); // write 1, exactly once
    expect(page2.older).toBeNull();
  });

  // (d) "one now(), three rows": a single transaction's three rows are ONE write, never split by
  // anything, foreign or not — a foreign entry at the identical instant cannot pull it apart.
  it("(d) one now(), three rows: always one group, even with a foreign entry at the SAME instant", async () => {
    const T = "2026-11-02T00:00:00.500000+00:00";
    const rows: RawRow[] = [
      row({ id: 3, xact: 9, created_at: T, field: "email" }),
      row({ id: 2, xact: 9, created_at: T, field: "last_name" }),
      row({ id: 1, xact: 9, created_at: T, field: "first_name" }),
    ];
    const notes: NoteRow[] = [note({ id: "n1", created_at: T })];
    const db = fakeDb(rows, notes);
    const page = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 5 });
    const change = page.items.find((e) => e.kind === "change");
    expect(change).toBeDefined();
    if (change!.kind !== "change") throw new Error("unreachable");
    expect(change!.group.rows).toHaveLength(3);
  });

  // (e) "id order ≠ time order (now() = txn start, identity at insert; a long merge beside a short
  // edit)": write M's transaction STARTS early (created_at = T_early) but, being long-running,
  // INSERTS late (a LARGE id); write S starts later (created_at = T_later) but inserts early (a SMALL
  // id). Different `via`, so they never fold regardless. Paging must follow created_at (what the
  // merged timeline itself sorts by), never id alone.
  it("(e) id order disagreeing with created_at order never skips the earlier-created_at, larger-id write (mutation: revert listChangeRows to .lt('id', before.id) -> FAILS, the long write is wrongly excluded as if already read)", async () => {
    const T_EARLY = "2026-11-02T00:00:00.000000+00:00"; // M's txn started here (long-running)
    const T_LATER = "2026-11-02T00:05:00.000000+00:00"; // S's txn started here, but inserted FIRST
    const rows: RawRow[] = [
      row({ id: 10, created_at: T_EARLY, xact: 1, via: "merge:1", author_id: "user_m", field: "first_name" }), // M: large id, early created_at
      row({ id: 1, created_at: T_LATER, xact: 2, via: null, author_id: "user_s", field: "last_name" }), // S: small id, later created_at
    ];
    const db = fakeDb(rows);
    const page1 = await listTimelinePage(db, "a1", ["c1"], undefined, { changes: true, limit: 1 });
    expect(page1.items).toHaveLength(1);
    const first = page1.items[0]!;
    if (first.kind !== "change") throw new Error("unreachable");
    expect(first.group.rows.map((r) => r.id)).toEqual([1]); // S shows first: its created_at is NEWER
    expect(page1.older).not.toBeNull();

    const page2 = await listTimelinePage(db, "a1", ["c1"], page1.older!, { changes: true, limit: 1 });
    expect(page2.items).toHaveLength(1); // M must still appear — never silently skipped
    const second = page2.items[0]!;
    if (second.kind !== "change") throw new Error("unreachable");
    expect(second.group.rows.map((r) => r.id)).toEqual([10]);
    expect(page2.older).toBeNull();
  });
});
