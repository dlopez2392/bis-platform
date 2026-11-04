import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canPutBack, canRestore, parseChangeId, RESTORE_DAYS, putBackChange, restoreRemoved } from "./record-restore";
import { DOCUMENT_TRASH_DAYS } from "./document-rules";
import type { ChangeRow } from "./record-changes";
import type { GroupMemberSnapshot } from "./client-groups";
import { restoreMembership } from "./client-groups";

// F-115 PR C fix (m1): `restoreMembershipRow` calls `restoreMembership(serviceDb(), ...)` — mocked so
// a concurrent-restore 23505 can be simulated without a live `restore_group_membership` RPC, and so
// `serviceDb()` (which throws with no env vars at all) is never actually invoked for real.
vi.mock("./client-groups", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  restoreMembership: vi.fn(),
}));
vi.mock("./service", () => ({ serviceDb: () => ({}) }));

/**
 * F-115 Task 6 (plan Task 6 Step 1): the pure decisions behind "Put back" and "Restore" — which
 * change rows offer each, and the 30-day Restore window. Most of this file stays pure (no Supabase
 * client). F-115 PR C's fix round adds a few fake-db tests (I3's Postgres-code mapping, I4's account
 * filter, m1's membership pair check) — `queueDb` below, the same queue-of-answers shape
 * `history-actions.test.ts`'s own REQUEST fake already uses elsewhere in this repo.
 */

const BASE: ChangeRow = {
  id: 1, recordType: "contact", recordId: "11111111-1111-1111-1111-111111111111",
  contactId: "11111111-1111-1111-1111-111111111111", clientGroupId: null,
  op: "update", field: "first_name", before: "Dan", after: "Daniel", xact: "100",
  authorKind: "person", authorId: "user_1", via: null, createdAt: "2026-01-01T00:00:00+00:00",
};
const row = (patch: Partial<ChangeRow>): ChangeRow => ({ ...BASE, ...patch });

type Answer = { data: unknown; error: { message: string; code?: string } | null };

/** A fake client that answers every terminal call (`.maybeSingle()`, or `await`-ing the builder
 *  itself) from a shared queue, in call order — never branching on a filter's value. Good enough for
 *  every test here except I4's (below), which needs the filters themselves checked. */
function queueDb() {
  const queue: Answer[] = [];
  function chain(table: string) {
    const obj: Record<string, (...a: never[]) => unknown> = {};
    const rec = () => obj;
    obj.select = rec; obj.update = rec; obj.insert = rec; obj.eq = rec; obj.is = rec; obj.setHeader = rec;
    obj.maybeSingle = async () => queue.shift() ?? { data: null, error: null };
    obj.then = ((resolve: (v: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve)) as never;
    void table;
    return obj;
  }
  const db = { from: (table: string) => chain(table), rpc: (fn: string) => chain(fn) };
  return { db: db as unknown as SupabaseClient, push: (a: Answer) => queue.push(a) };
}

/**
 * F-115 PR C fix (I4): unlike `queueDb`, this one actually filters — `.maybeSingle()` answers the one
 * stored row only when EVERY `.eq()` actually chained onto the query matches it, so a real code change
 * that drops a filter (the account one, by name) changes what this fake returns too, not just what the
 * production code intends.
 */
function accountFilteredDb(storedRow: Record<string, unknown>) {
  const seen: { table: string; filters: [string, unknown][] }[] = [];
  function chain(table: string, filters: [string, unknown][]) {
    const obj: Record<string, (...a: unknown[]) => unknown> = {};
    obj.select = () => chain(table, filters);
    obj.eq = (c: unknown, v: unknown) => chain(table, [...filters, [c as string, v]]);
    obj.maybeSingle = async () => {
      seen.push({ table, filters });
      const match = filters.every(([c, v]) => storedRow[c] === v);
      return { data: match ? storedRow : null, error: null };
    };
    return obj;
  }
  return { db: { from: (table: string) => chain(table, []) } as unknown as SupabaseClient, seen };
}

/**
 * F-115 PR C fix (m1): like `accountFilteredDb`, but keyed by table name, so one fake can answer
 * `record_changes`'s read (`getChangeRow`) AND `client_group_members`'s existence check with REAL
 * per-table filtering — the only way to prove the existence check now matches by (client_group_id,
 * contact_id) rather than by `id` alone (a fake that ignores filter values could not tell the two
 * apart, the way a plain call-order queue cannot).
 */
function tableDb(tables: Record<string, Record<string, unknown>[]>) {
  function chain(table: string, filters: [string, unknown][]) {
    const obj: Record<string, (...a: unknown[]) => unknown> = {};
    obj.select = () => chain(table, filters);
    obj.eq = (c: unknown, v: unknown) => chain(table, [...filters, [c as string, v]]);
    obj.maybeSingle = async () => {
      const rows = tables[table] ?? [];
      const match = rows.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null;
      return { data: match, error: null };
    };
    return obj;
  }
  return { db: { from: (table: string) => chain(table, []) } as unknown as SupabaseClient };
}

describe("RESTORE_DAYS", () => {
  it("is the document trash window, not a second 30", () => {
    expect(RESTORE_DAYS).toBe(DOCUMENT_TRASH_DAYS);
    expect(RESTORE_DAYS).toBe(30);
  });
});

describe("canPutBack", () => {
  it("is true for an audited field update on a contact", () => {
    expect(canPutBack(row({}))).toBe(true);
  });

  it("is true for every audited field across the put-back-eligible types", () => {
    expect(canPutBack(row({ recordType: "client_group", field: "name" }))).toBe(true);
    expect(canPutBack(row({ recordType: "place", field: "archived_at" }))).toBe(true);
    expect(canPutBack(row({ recordType: "equipment", field: "warranty_until" }))).toBe(true);
    expect(canPutBack(row({ recordType: "opportunity", field: "stage_id" }))).toBe(true);
    expect(canPutBack(row({ recordType: "contact_relationship", field: "label_key" }))).toBe(true);
  });

  it("is true for a contact's own custom.<key>", () => {
    expect(canPutBack(row({ field: "custom.referral_source" }))).toBe(true);
  });

  it("is false for an opportunity's or client_group's custom.<key> (no compare-and-swap exists for either)", () => {
    expect(canPutBack(row({ recordType: "opportunity", field: "custom.priority" }))).toBe(false);
    expect(canPutBack(row({ recordType: "client_group", field: "custom.flag" }))).toBe(false);
  });

  it("is false for an insert row", () => {
    expect(canPutBack(row({ op: "insert", field: null, before: null, after: { first_name: "Dan" } }))).toBe(false);
  });

  it("is false for a delete row", () => {
    expect(canPutBack(row({ op: "delete", field: null, before: { first_name: "Dan" }, after: null }))).toBe(false);
  });

  it("is false for contact_tag", () => {
    expect(canPutBack(row({ recordType: "contact_tag", recordId: "22222222-2222-2222-2222-222222222222", field: "name" }))).toBe(false);
  });

  it("is false for client_group_member, even on its own audited field", () => {
    expect(canPutBack(row({ recordType: "client_group_member", field: "role" }))).toBe(false);
  });

  it("is false for an EXCLUDED field (a hand-built row claiming an update on a column 0111/0112 never audits)", () => {
    expect(canPutBack(row({ field: "updated_at" }))).toBe(false);
    expect(canPutBack(row({ recordType: "contact", field: "reactivation_sent_at" }))).toBe(false);
  });
});

/**
 * F-115 PR C fix (I3): fields `canPutBack` must refuse even though each would otherwise qualify —
 * `dnd` is jsonb (a plain `.eq` compare against an object becomes the literal string
 * "[object Object]", so a CAS guard built that way can never genuinely match), a bare `custom` row
 * has no per-key compare-and-swap (only `custom.<key>` does, via `put_back_contact_custom`), and a
 * place's `contact_id`/`client_group_id` are coupled by `places_one_owner` — writing either back
 * alone, while the other still holds its "after" value, can leave a place with zero or two owners.
 */
describe("canPutBack: PUT_BACK_EXCLUDED fields never offer Put back (I3; mutation: drop the PUT_BACK_EXCLUDED check -> every assertion below flips to true, FAILS)", () => {
  it("contact.dnd is excluded (jsonb)", () => {
    expect(canPutBack(row({ field: "dnd", before: { calls: true }, after: { calls: false } }))).toBe(false);
  });

  it("a bare contact.custom row is excluded (no per-key CAS)", () => {
    expect(canPutBack(row({ field: "custom", before: { a: 1 }, after: { a: 2 } }))).toBe(false);
  });

  it("place.contact_id and place.client_group_id are excluded (places_one_owner coupling)", () => {
    expect(canPutBack(row({ recordType: "place", field: "contact_id" }))).toBe(false);
    expect(canPutBack(row({ recordType: "place", field: "client_group_id" }))).toBe(false);
  });

  it("custom.<key> itself is unaffected: still true on a contact", () => {
    expect(canPutBack(row({ field: "custom.referral_source" }))).toBe(true);
  });
});

const deleteRow = (patch: Partial<ChangeRow>): ChangeRow => row({
  recordType: "equipment", op: "delete", field: null, before: { id: "x" }, after: null, ...patch,
});

describe("canRestore", () => {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const dayMs = 24 * 60 * 60 * 1000;

  it("is true at day 29", () => {
    const now = new Date(Date.parse(createdAt) + 29 * dayMs);
    expect(canRestore(deleteRow({ createdAt }), now)).toBe(true);
  });

  it("is false at day 30 plus 1 ms (mutation: compare against 31 days instead of RESTORE_DAYS would make this pass incorrectly)", () => {
    const now = new Date(Date.parse(createdAt) + 30 * dayMs + 1);
    expect(canRestore(deleteRow({ createdAt }), now)).toBe(false);
  });

  it("is true for every restorable type", () => {
    const now = new Date(Date.parse(createdAt) + dayMs);
    for (const recordType of ["equipment", "client_group_member", "contact_tag", "contact_relationship", "place"] as const) {
      expect(canRestore(deleteRow({ createdAt, recordType }), now)).toBe(true);
    }
  });

  it("is false for contact and opportunity (not restorable types)", () => {
    const now = new Date(Date.parse(createdAt) + dayMs);
    expect(canRestore(deleteRow({ createdAt, recordType: "contact" }), now)).toBe(false);
    expect(canRestore(deleteRow({ createdAt, recordType: "opportunity" }), now)).toBe(false);
  });

  it("is false for an update row (op must be delete)", () => {
    const now = new Date(Date.parse(createdAt) + dayMs);
    expect(canRestore(row({ createdAt, recordType: "equipment", op: "update", field: "name" }), now)).toBe(false);
  });
});

describe("parseChangeId", () => {
  it("accepts a positive integer", () => {
    expect(parseChangeId(42)).toBe(42);
  });

  it("accepts a digit string", () => {
    expect(parseChangeId("42")).toBe(42);
  });

  it("accepts a 19-digit string within Number's safe range only if it stays safe (large example refused)", () => {
    // 19 nines is far past Number.MAX_SAFE_INTEGER; the digit-length check alone would accept it, so the
    // safe-integer check must still catch it (mutation: drop the safe-integer check -> this FAILS).
    expect(parseChangeId("9999999999999999999")).toBe(null);
  });

  it("refuses a 20-digit string (over the bigint-width cap) even if it happened to parse)", () => {
    expect(parseChangeId("123456789012345678901")).toBe(null);
  });

  it("refuses non-digit strings", () => {
    expect(parseChangeId("42abc")).toBe(null);
    expect(parseChangeId("-1")).toBe(null);
    expect(parseChangeId("4.2")).toBe(null);
    expect(parseChangeId("")).toBe(null);
  });

  it("refuses a non-integer or non-positive number", () => {
    expect(parseChangeId(4.2)).toBe(null);
    expect(parseChangeId(0)).toBe(null);
    expect(parseChangeId(-5)).toBe(null);
  });
});

/**
 * F-115 PR C fix (I4): `getChangeRow` (record-restore.ts) filters on `account_id` as well as `id` —
 * the only tie between a `changeId` and the URL's own account. For an agency user RLS sees every
 * account, so that filter is load-bearing, not a belt-and-suspenders extra.
 */
describe("putBackChange: the change row's account filter (I4)", () => {
  it("a change row belonging to another account answers not_found, never reaching a write (mutation: drop .eq('account_id', ...) in getChangeRow -> the filters assertion FAILS)", async () => {
    const storedRow = {
      id: 42, record_type: "contact", record_id: "11111111-1111-1111-1111-111111111111",
      contact_id: "11111111-1111-1111-1111-111111111111", client_group_id: null,
      op: "update", field: "first_name", before: "Dan", after: "Daniel", xact: "100",
      author_kind: "person", author_id: "user_1", via: null, created_at: "2026-01-01T00:00:00Z",
      account_id: "account-B", // the row's REAL account — never the caller's
    };
    const { db, seen } = accountFilteredDb(storedRow);
    const outcome = await putBackChange(db, "account-A", 42, { authorKind: "person", authorId: "user_1" });
    expect(outcome).toBe("not_found");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.filters).toEqual([["account_id", "account-A"], ["id", 42]]);
  });
});

/**
 * F-115 PR C fix (I3): a Postgres error during the compare-and-swap write itself — check_violation
 * (23514), invalid_text_representation (22P02) or invalid_parameter_value (22023) — answers "changed"
 * (the write didn't happen; a stale value is the honest-enough reading of "the data refused it too"),
 * logged with its code, never thrown and never mapped to history.notFound.
 */
describe("putBackChange: 23514/22P02/22023 on the write map to 'changed', logged, never thrown (I3)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it.each(["23514", "22P02", "22023"])("code %s -> changed", async (code) => {
    const { db, push } = queueDb();
    push({ // getChangeRow
      data: {
        id: 1, record_type: "contact", record_id: "c1", contact_id: "c1", client_group_id: null,
        op: "update", field: "source", before: "a", after: "b", xact: "1",
        author_kind: "person", author_id: "user_1", via: null, created_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    });
    push({ data: null, error: { message: "refused by a check", code } }); // the update itself
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await putBackChange(db, "a1", 1, { authorKind: "person", authorId: "user_1" });
    expect(outcome).toBe("changed");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain(code);
  });

  it("any OTHER Postgres error code still throws (not silently swallowed)", async () => {
    const { db, push } = queueDb();
    push({
      data: {
        id: 1, record_type: "contact", record_id: "c1", contact_id: "c1", client_group_id: null,
        op: "update", field: "source", before: "a", after: "b", xact: "1",
        author_kind: "person", author_id: "user_1", via: null, created_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    });
    push({ data: null, error: { message: "connection lost", code: "08006" } });
    await expect(putBackChange(db, "a1", 1, { authorKind: "person", authorId: "user_1" })).rejects.toThrow();
  });
});

/**
 * F-115 PR C fix (m1): a membership's "already back" must be decided by the (client_group_id,
 * contact_id) PAIR, not only by the original row's own id — a re-added member is a NEW
 * `client_group_members` row (a different id) linking the SAME pair, and that must answer
 * already_back too, never "restored" a second time. A 23505 from a genuinely concurrent restore
 * (both racers passing the pre-check before either commits) answers the same way.
 */
describe("restoreRemoved: client_group_member already-back is checked by (group, contact) (m1)", () => {
  beforeEach(() => {
    vi.mocked(restoreMembership).mockReset();
  });

  function membershipChangeRow() {
    const snapshot: GroupMemberSnapshot = {
      id: "33333333-3333-3333-3333-333333333333", account_id: "a1",
      client_group_id: "44444444-4444-4444-4444-444444444444", contact_id: "55555555-5555-5555-5555-555555555555",
      role: null, is_primary: false, is_billing: false, is_primary_contact: false,
      created_at: "2026-01-01T00:00:00Z",
    };
    const changeRow = {
      id: 1, account_id: "a1", record_type: "client_group_member", record_id: snapshot.id, contact_id: snapshot.contact_id,
      client_group_id: snapshot.client_group_id, op: "delete", field: null, before: snapshot, after: null,
      // Within the 30-day Restore window of "now" (canRestore runs before any of this): a fixed past
      // date would read "expired" once this test is more than 30 days old.
      xact: "1", author_kind: "person", author_id: "user_1", via: null, created_at: new Date().toISOString(),
    };
    return { changeRow, snapshot };
  }

  it("a DIFFERENT membership row already linking the same pair answers already_back, not restored (mutation: check existence by id alone -> FAILS)", async () => {
    const { changeRow, snapshot } = membershipChangeRow();
    // An existing membership row with a DIFFERENT id, but the SAME (client_group_id, contact_id) pair.
    const existingRow = {
      id: "99999999-9999-9999-9999-999999999999", account_id: "a1",
      client_group_id: snapshot.client_group_id, contact_id: snapshot.contact_id,
    };
    const { db } = tableDb({ record_changes: [changeRow], client_group_members: [existingRow] });
    const outcome = await restoreRemoved(db, "a1", 1, { authorKind: "person", authorId: "user_1" }, new Date());
    expect(outcome).toBe("already_back");
    expect(restoreMembership).not.toHaveBeenCalled();
  });

  it("a concurrent restore's 23505 answers already_back, never throws", async () => {
    const { changeRow } = membershipChangeRow();
    const { db } = tableDb({ record_changes: [changeRow], client_group_members: [] }); // no row yet: the race
    vi.mocked(restoreMembership).mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));
    const outcome = await restoreRemoved(db, "a1", 1, { authorKind: "person", authorId: "user_1" }, new Date());
    expect(outcome).toBe("already_back");
  });

  it("no existing member and no race: restores normally", async () => {
    const { changeRow } = membershipChangeRow();
    const { db } = tableDb({ record_changes: [changeRow], client_group_members: [] });
    vi.mocked(restoreMembership).mockResolvedValueOnce("ok");
    const outcome = await restoreRemoved(db, "a1", 1, { authorKind: "person", authorId: "user_1" }, new Date());
    expect(outcome).toBe("restored");
  });
});

/**
 * F-115 PR C fix (I3): a restore write that Postgres itself refuses with 23514/22P02/22023 — the old
 * snapshot no longer fits a constraint or type added since the row was deleted — answers "failed"
 * (never "not_found", never a crash), logged with its code. `contact_tag`'s own restore (a plain
 * named-column insert) is the one path here with no mocked writer underneath it, so it is the one
 * this exercises directly.
 */
describe("restoreRemoved: 23514/22P02/22023 on the write answer 'failed', logged, never thrown (I3)", () => {
  it.each(["23514", "22P02", "22023"])("code %s -> failed", async (code) => {
    const changeRow = {
      id: 1, account_id: "a1", record_type: "contact_tag",
      record_id: "66666666-6666-6666-6666-666666666666", contact_id: "11111111-1111-1111-1111-111111111111",
      client_group_id: null, op: "delete", field: null,
      before: { contact_id: "11111111-1111-1111-1111-111111111111", tag_id: "66666666-6666-6666-6666-666666666666", account_id: "a1" },
      after: null, xact: "1", author_kind: "person", author_id: "user_1", via: null, created_at: new Date().toISOString(),
    };
    const { db, push } = queueDb();
    push({ data: changeRow, error: null }); // getChangeRow
    push({ data: null, error: { message: "refused by a check", code } }); // the insert
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await restoreRemoved(db, "a1", 1, { authorKind: "person", authorId: "user_1" }, new Date());
    expect(outcome).toBe("failed");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain(code);
    spy.mockRestore();
  });
});
