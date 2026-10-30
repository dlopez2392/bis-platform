import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listDuplicatePairs, countDuplicatePairs, duplicatePairsOf, dismissDuplicatePair, undismissDuplicatePair,
  mergeContacts, undoContactMerge, contactMergePreview, followMerge, mergedIdsOf, mergeKeptIdOf, MergeRpcError,
  DUPLICATE_PAGE_MAX, MERGE_COUNT_KEYS,
} from "./contact-merge";

/**
 * Task 5 (F-006), pure half: the typed wrappers around 0106's merge RPCs and the two plain reads
 * (`followMerge`, `mergedIdsOf`). No database — a fake client records every `rpc(name, args)` call and
 * every `.from("contacts")` chain call, and answers per the fixture given. The live half (CI only, 0106
 * is not on bis-ci) is `test/contact-merge-live.test.ts`.
 */
type Answer = { data: unknown; error: unknown };

function fakeDb(opts: { rpc?: Record<string, Answer>; from?: Record<string, Answer> } = {}) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const fromCalls: { table: string; method: string; args: unknown[] }[] = [];
  const db = {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      const answer = (opts.rpc ?? {})[name] ?? { data: null, error: null };
      return Promise.resolve(answer);
    },
    from: (table: string) => {
      const answer = (opts.from ?? {})[table] ?? { data: null, error: null };
      const chain: unknown = new Proxy({}, {
        get(_t, method: string) {
          if (method === "then") {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(answer).then(res, rej);
          }
          return (...args: unknown[]) => { fromCalls.push({ table, method, args }); return chain; };
        },
      });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, rpcCalls, fromCalls };
}
const rpcArgs = (calls: { name: string; args: unknown }[], name: string) =>
  calls.find((c) => c.name === name)?.args as Record<string, unknown> | undefined;
const hasFrom = (calls: { table: string; method: string; args: unknown[] }[], table: string, method: string, ...args: unknown[]) =>
  calls.some((c) => c.table === table && c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

const PAIR_ROW = {
  id: "flag-1", contact_a: "a1", contact_b: "b1", reason: "same_phone", strength: 1, created_at: "2026-10-29T00:00:00.123456+00:00",
  a_first_name: "Ana", a_last_name: "Ruiz", b_first_name: "Anna", b_last_name: "Ruiz",
};
const MAPPED_PAIR = {
  id: "flag-1",
  a: { id: "a1", firstName: "Ana", lastName: "Ruiz" },
  b: { id: "b1", firstName: "Anna", lastName: "Ruiz" },
  reason: "same_phone", strength: 1, createdAt: "2026-10-29T00:00:00.123456+00:00",
};

describe("listDuplicatePairs: duplicate_pairs_page, a cursor passed through verbatim, a clamped limit, mapped rows", () => {
  it("a cold start (no opts.after) sends every p_after_* as null, and maps rows to DuplicatePair", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: { duplicate_pairs_page: { data: [PAIR_ROW], error: null } } });
    const result = await listDuplicatePairs(db, "acct-1");
    const args = rpcArgs(rpcCalls, "duplicate_pairs_page");
    expect(args?.p_account_id).toBe("acct-1");
    expect(args?.p_after_strength).toBeNull();
    expect(args?.p_after_created_at).toBeNull();
    expect(args?.p_after_id).toBeNull();
    expect(result).toEqual([MAPPED_PAIR]);
  });

  it("a cursor's three values travel verbatim: the createdAt string is NEVER re-formatted through a Date (mutation: new Date(x).toISOString() -> the sub-millisecond digits FAIL)", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: { duplicate_pairs_page: { data: [], error: null } } });
    const after = { strength: 4, createdAt: "2026-10-29T00:00:00.123456+00:00", id: "flag-9" };
    await listDuplicatePairs(db, "acct-1", { after });
    const args = rpcArgs(rpcCalls, "duplicate_pairs_page");
    expect(args?.p_after_strength).toBe(4);
    expect(args?.p_after_created_at).toBe("2026-10-29T00:00:00.123456+00:00");
    expect(args?.p_after_id).toBe("flag-9");
  });

  it("clamps the limit to 1..DUPLICATE_PAGE_MAX + 1 (mutation: pass opts.limit through unclamped -> these FAIL)", async () => {
    const low = fakeDb({ rpc: { duplicate_pairs_page: { data: [], error: null } } });
    await listDuplicatePairs(low.db, "acct-1", { limit: 0 });
    expect(rpcArgs(low.rpcCalls, "duplicate_pairs_page")?.p_limit).toBe(1);

    const high = fakeDb({ rpc: { duplicate_pairs_page: { data: [], error: null } } });
    await listDuplicatePairs(high.db, "acct-1", { limit: 9999 });
    expect(rpcArgs(high.rpcCalls, "duplicate_pairs_page")?.p_limit).toBe(DUPLICATE_PAGE_MAX + 1);

    const cold = fakeDb({ rpc: { duplicate_pairs_page: { data: [], error: null } } });
    await listDuplicatePairs(cold.db, "acct-1");
    const coldLimit = rpcArgs(cold.rpcCalls, "duplicate_pairs_page")?.p_limit as number;
    expect(coldLimit).toBeGreaterThanOrEqual(1);
    expect(coldLimit).toBeLessThanOrEqual(DUPLICATE_PAGE_MAX + 1);
  });

  it("throws on a NaN limit rather than silently sending NaN over the wire (`??` only replaces null/undefined, never NaN; JSON would otherwise have turned it into a silent `null`; mutation: let it fall through to Math.min/Math.max -> FAILS)", async () => {
    const { db } = fakeDb({ rpc: { duplicate_pairs_page: { data: [], error: null } } });
    await expect(listDuplicatePairs(db, "acct-1", { limit: NaN })).rejects.toThrow(/NaN/);
  });

  it("throws on an RPC error", async () => {
    const { db } = fakeDb({ rpc: { duplicate_pairs_page: { data: null, error: { message: "boom" } } } });
    await expect(listDuplicatePairs(db, "acct-1")).rejects.toThrow("listDuplicatePairs failed: boom");
  });
});

describe("countDuplicatePairs", () => {
  it("returns the number duplicate_pairs_count answers", async () => {
    const { db } = fakeDb({ rpc: { duplicate_pairs_count: { data: 3, error: null } } });
    expect(await countDuplicatePairs(db, "acct-1")).toBe(3);
  });

  it("THROWS on a null answer (the head-count-null lesson; mutation: `?? 0` -> FAILS)", async () => {
    const { db } = fakeDb({ rpc: { duplicate_pairs_count: { data: null, error: null } } });
    await expect(countDuplicatePairs(db, "acct-1")).rejects.toThrow();
  });

  it("throws on an RPC error", async () => {
    const { db } = fakeDb({ rpc: { duplicate_pairs_count: { data: null, error: { message: "boom" } } } });
    await expect(countDuplicatePairs(db, "acct-1")).rejects.toThrow("countDuplicatePairs failed: boom");
  });
});

describe("duplicatePairsOf", () => {
  it("calls duplicate_pairs_of with the account and the contact, and maps rows", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: { duplicate_pairs_of: { data: [PAIR_ROW], error: null } } });
    const result = await duplicatePairsOf(db, "acct-1", "a1");
    expect(rpcArgs(rpcCalls, "duplicate_pairs_of")).toEqual({ p_account_id: "acct-1", p_contact_id: "a1" });
    expect(result).toEqual([MAPPED_PAIR]);
  });

  it("throws on an RPC error", async () => {
    const { db } = fakeDb({ rpc: { duplicate_pairs_of: { data: null, error: { message: "boom" } } } });
    await expect(duplicatePairsOf(db, "acct-1", "a1")).rejects.toThrow("duplicatePairsOf failed: boom");
  });
});

describe("dismissDuplicatePair / undismissDuplicatePair: the status word, the actor passed through (null when absent)", () => {
  it("dismissDuplicatePair returns \"dismissed\" and sends p_actor null when none is given", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: { dismiss_duplicate_pair: { data: { status: "dismissed" }, error: null } } });
    expect(await dismissDuplicatePair(db, "acct-1", "flag-1")).toBe("dismissed");
    expect(rpcArgs(rpcCalls, "dismiss_duplicate_pair")).toEqual({ p_account_id: "acct-1", p_flag_id: "flag-1", p_actor: null });
  });

  it("dismissDuplicatePair returns \"not_found\" and sends the actor when given", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: { dismiss_duplicate_pair: { data: { status: "not_found" }, error: null } } });
    expect(await dismissDuplicatePair(db, "acct-1", "flag-1", "user_1")).toBe("not_found");
    expect(rpcArgs(rpcCalls, "dismiss_duplicate_pair")).toEqual({ p_account_id: "acct-1", p_flag_id: "flag-1", p_actor: "user_1" });
  });

  it("dismissDuplicatePair throws on an unexpected shape", async () => {
    const { db } = fakeDb({ rpc: { dismiss_duplicate_pair: { data: { status: "bogus" }, error: null } } });
    await expect(dismissDuplicatePair(db, "acct-1", "flag-1")).rejects.toThrow();
  });

  it("undismissDuplicatePair returns \"restored\"", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: { undismiss_duplicate_pair: { data: { status: "restored" }, error: null } } });
    expect(await undismissDuplicatePair(db, "acct-1", "flag-1")).toBe("restored");
    expect(rpcArgs(rpcCalls, "undismiss_duplicate_pair")).toEqual({ p_account_id: "acct-1", p_flag_id: "flag-1", p_actor: null });
  });

  it("undismissDuplicatePair returns \"not_found\"", async () => {
    const { db } = fakeDb({ rpc: { undismiss_duplicate_pair: { data: { status: "not_found" }, error: null } } });
    expect(await undismissDuplicatePair(db, "acct-1", "flag-1")).toBe("not_found");
  });

  it("undismissDuplicatePair throws on an unexpected shape", async () => {
    const { db } = fakeDb({ rpc: { undismiss_duplicate_pair: { data: { status: "bogus" }, error: null } } });
    await expect(undismissDuplicatePair(db, "acct-1", "flag-1")).rejects.toThrow();
  });
});

describe("mergeContacts: sends p_choices, p_seen and p_actor (null when absent); parses every status", () => {
  const CHOICES = { first_name: "keep" as const };
  const SEEN = { keep: "a".repeat(32), other: "b".repeat(32) };

  it("sends every argument, p_actor null when input.actor is absent", async () => {
    const { db, rpcCalls } = fakeDb({
      rpc: { merge_contacts: { data: { status: "merged", mergeId: 7, moved: { messages: 2 } }, error: null } },
    });
    const result = await mergeContacts(db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES, seen: SEEN });
    expect(rpcArgs(rpcCalls, "merge_contacts")).toEqual({
      p_account_id: "acct-1", p_keep: "k1", p_other: "o1", p_choices: CHOICES, p_seen: SEEN, p_actor: null,
    });
    expect(result).toEqual({ status: "merged", mergeId: 7, moved: { messages: 2 } });
  });

  it("sends the actor when input.actor is given", async () => {
    const { db, rpcCalls } = fakeDb({
      rpc: { merge_contacts: { data: { status: "merged", mergeId: 1, moved: {} }, error: null } },
    });
    await mergeContacts(db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES, seen: SEEN, actor: "user_1" });
    expect(rpcArgs(rpcCalls, "merge_contacts")?.p_actor).toBe("user_1");
  });

  it.each(["same", "not_found", "holding", "already_merged", "stale"] as const)(
    "parses the refusal %s", async (status) => {
      const { db } = fakeDb({ rpc: { merge_contacts: { data: { status }, error: null } } });
      const result = await mergeContacts(db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES, seen: SEEN });
      expect(result).toEqual({ status });
    },
  );

  it("throws on an unknown shape (mutation: return it as 'merged' -> FAILS)", async () => {
    const { db } = fakeDb({ rpc: { merge_contacts: { data: { status: "whatever-else" }, error: null } } });
    await expect(mergeContacts(db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES, seen: SEEN }))
      .rejects.toThrow();
  });

  it("throws when a moved count is not a number — \"an object\" alone let a non-numeric count through silently (mutation: drop the per-value number check -> FAILS)", async () => {
    const { db } = fakeDb({
      rpc: { merge_contacts: { data: { status: "merged", mergeId: 1, moved: { messages: "2" } }, error: null } },
    });
    await expect(mergeContacts(db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES, seen: SEEN }))
      .rejects.toThrow();
  });

  it("throws on an RPC error", async () => {
    const { db } = fakeDb({ rpc: { merge_contacts: { data: null, error: { message: "boom" } } } });
    await expect(mergeContacts(db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES, seen: SEEN }))
      .rejects.toThrow("mergeContacts failed: boom");
  });
});

describe("undoContactMerge: parses \"undone\" with keptNew/keptEdits, and the four refusals", () => {
  it("parses \"undone\"", async () => {
    const { db, rpcCalls } = fakeDb({
      rpc: { undo_contact_merge: { data: { status: "undone", otherId: "o1", keptNew: 2, keptEdits: ["email"] }, error: null } },
    });
    const result = await undoContactMerge(db, "acct-1", 42, "user_1");
    expect(rpcArgs(rpcCalls, "undo_contact_merge")).toEqual({ p_account_id: "acct-1", p_merge_id: 42, p_actor: "user_1" });
    expect(result).toEqual({ status: "undone", otherId: "o1", keptNew: 2, keptEdits: ["email"] });
  });

  it("sends p_actor null when absent", async () => {
    const { db, rpcCalls } = fakeDb({
      rpc: { undo_contact_merge: { data: { status: "undone", otherId: "o1", keptNew: 0, keptEdits: [] }, error: null } },
    });
    await undoContactMerge(db, "acct-1", 42);
    expect(rpcArgs(rpcCalls, "undo_contact_merge")?.p_actor).toBeNull();
  });

  it.each(["not_found", "already_undone", "expired", "later_merge"] as const)(
    "parses the refusal %s", async (status) => {
      const { db } = fakeDb({ rpc: { undo_contact_merge: { data: { status }, error: null } } });
      expect(await undoContactMerge(db, "acct-1", 42)).toEqual({ status });
    },
  );

  it("throws on an unknown shape", async () => {
    const { db } = fakeDb({ rpc: { undo_contact_merge: { data: { status: "undone", otherId: "o1" }, error: null } } });
    await expect(undoContactMerge(db, "acct-1", 42)).rejects.toThrow();
  });

  it("throws on an RPC error", async () => {
    const { db } = fakeDb({ rpc: { undo_contact_merge: { data: null, error: { message: "boom" } } } });
    await expect(undoContactMerge(db, "acct-1", 42)).rejects.toThrow("undoContactMerge failed: boom");
  });
});

/** Fix round, carry-in 4/5: a scripted `rpc` that answers each CALL in order (falling back to the
 *  last answer once exhausted), the same shape `client-groups-guards.test.ts`'s `scriptedRpcDb` uses
 *  for `setContactsBusiness`'s own deadlock retry. */
function scriptedRpcDb(answers: { data?: unknown; error?: { code: string; message: string } }[]) {
  let calls = 0;
  const db = {
    rpc: (_name: string, _args: unknown) => {
      const a = answers[Math.min(calls, answers.length - 1)]!;
      calls++;
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { db, calls: () => calls };
}
const DEADLOCK = { code: "40P01", message: "deadlock detected" };
const FK_VIOLATION = { code: "23503", message: "violates foreign key constraint" };
const MERGED_OK = { status: "merged", mergeId: 7, moved: { messages: 1 } };
const UNDONE_OK = { status: "undone", otherId: "o1", keptNew: 0, keptEdits: [] };
const CHOICES2 = { first_name: "keep" as const };
const SEEN2 = { keep: "a".repeat(32), other: "b".repeat(32) };

describe("mergeContacts / undoContactMerge: retry a 40P01 deadlock ONCE, a second surfaces as the usual failure (fix round, carry-in 4)", () => {
  it("mergeContacts: a deadlock then success is retried once, answers the second call (mutation: drop the 40P01 retry -> FAILS)", async () => {
    const s = scriptedRpcDb([{ error: DEADLOCK }, { data: MERGED_OK }]);
    const r = await mergeContacts(s.db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES2, seen: SEEN2 });
    expect(r).toEqual({ status: "merged", mergeId: 7, moved: { messages: 1 } });
    expect(s.calls()).toBe(2);
  });

  it("mergeContacts: two deadlocks in a row give up after ONE retry (two calls total), throwing a MergeRpcError carrying the code (mutation: retry a second time -> calls() would be 3, FAILS)", async () => {
    const s = scriptedRpcDb([{ error: DEADLOCK }, { error: DEADLOCK }]);
    await expect(mergeContacts(s.db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES2, seen: SEEN2 }))
      .rejects.toMatchObject({ code: "40P01" });
    expect(s.calls()).toBe(2);
  });

  it("mergeContacts: any other error is never retried (mutation: retry every error -> calls() would be 2, FAILS)", async () => {
    const s = scriptedRpcDb([{ error: { code: "57014", message: "statement timeout" } }, { data: MERGED_OK }]);
    await expect(mergeContacts(s.db, "acct-1", { keepId: "k1", otherId: "o1", choices: CHOICES2, seen: SEEN2 }))
      .rejects.toThrow(/statement timeout/);
    expect(s.calls()).toBe(1);
  });

  it("undoContactMerge: a deadlock then success is retried once (mutation: drop the retry -> FAILS)", async () => {
    const s = scriptedRpcDb([{ error: DEADLOCK }, { data: UNDONE_OK }]);
    const r = await undoContactMerge(s.db, "acct-1", 42);
    expect(r).toEqual({ status: "undone", otherId: "o1", keptNew: 0, keptEdits: [] });
    expect(s.calls()).toBe(2);
  });

  it("undoContactMerge: two deadlocks give up after one retry, the thrown error still carries the code (mutation: swallow the code -> FAILS)", async () => {
    const s = scriptedRpcDb([{ error: DEADLOCK }, { error: DEADLOCK }]);
    await expect(undoContactMerge(s.db, "acct-1", 42)).rejects.toMatchObject({ code: "40P01" });
    expect(s.calls()).toBe(2);
  });

  it("undoContactMerge: a foreign-key violation (23503, something the merge re-inserts was deleted since) throws a MergeRpcError with that code, UNRETRIED (mutation: throw a plain Error without .code -> FAILS)", async () => {
    const s = scriptedRpcDb([{ error: FK_VIOLATION }]);
    const err = await undoContactMerge(s.db, "acct-1", 42).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MergeRpcError);
    expect((err as InstanceType<typeof MergeRpcError>).code).toBe("23503");
    expect(s.calls()).toBe(1);
  });
});

describe("mergeKeptIdOf: the KEPT side of one merge row, by account and merge id (fix round, carry-in 6)", () => {
  it("returns keep_id when the row exists", async () => {
    const { db, fromCalls } = fakeDb({ from: { contact_merges: { data: { keep_id: "k1" }, error: null } } });
    expect(await mergeKeptIdOf(db, "acct-1", 42)).toBe("k1");
    expect(hasFrom(fromCalls, "contact_merges", "eq", "account_id", "acct-1")).toBe(true);
    expect(hasFrom(fromCalls, "contact_merges", "eq", "id", 42)).toBe(true);
  });

  it("returns null when there is no such merge row (mutation: throw instead -> FAILS)", async () => {
    const { db } = fakeDb({ from: { contact_merges: { data: null, error: null } } });
    expect(await mergeKeptIdOf(db, "acct-1", 999)).toBeNull();
  });

  it("throws on a database error (mutation: swallow the error and return null -> FAILS)", async () => {
    const { db } = fakeDb({ from: { contact_merges: { data: null, error: { message: "boom" } } } });
    await expect(mergeKeptIdOf(db, "acct-1", 42)).rejects.toThrow("mergeKeptIdOf failed: boom");
  });
});

describe("contactMergePreview: every MERGE_COUNT_KEYS key, fields as objects, seen as 32-hex strings", () => {
  const fullCounts = Object.fromEntries(MERGE_COUNT_KEYS.map((k, i) => [k, i]));
  const okAnswer = {
    status: "ok", counts: fullCounts,
    fields: { keep: { first_name: "Ana" }, other: { first_name: "Anna" } },
    seen: { keep: "a".repeat(32), other: "b".repeat(32) },
  };

  it("parses a full \"ok\" answer", async () => {
    const { db, rpcCalls } = fakeDb({ rpc: { contact_merge_preview: { data: okAnswer, error: null } } });
    const result = await contactMergePreview(db, "acct-1", "k1", "o1");
    expect(rpcArgs(rpcCalls, "contact_merge_preview")).toEqual({ p_account_id: "acct-1", p_keep: "k1", p_other: "o1" });
    expect(result).toEqual(okAnswer);
  });

  it.each(["same", "not_found", "holding", "already_merged"] as const)(
    "parses the refusal %s", async (status) => {
      const { db } = fakeDb({ rpc: { contact_merge_preview: { data: { status }, error: null } } });
      expect(await contactMergePreview(db, "acct-1", "k1", "o1")).toEqual({ status });
    },
  );

  it("throws when a MERGE_COUNT_KEYS key is missing from counts", async () => {
    const partial = { ...okAnswer, counts: { ...fullCounts } };
    delete (partial.counts as Record<string, unknown>).messages;
    const { db } = fakeDb({ rpc: { contact_merge_preview: { data: partial, error: null } } });
    await expect(contactMergePreview(db, "acct-1", "k1", "o1")).rejects.toThrow();
  });

  it("throws when seen.other is missing (mutation: default a missing seen to '' -> FAILS)", async () => {
    const broken = { ...okAnswer, seen: { keep: "a".repeat(32) } };
    const { db } = fakeDb({ rpc: { contact_merge_preview: { data: broken, error: null } } });
    await expect(contactMergePreview(db, "acct-1", "k1", "o1")).rejects.toThrow();
  });

  it("throws when seen.keep is not a 32-character hex string", async () => {
    const broken = { ...okAnswer, seen: { keep: "not-hex", other: "b".repeat(32) } };
    const { db } = fakeDb({ rpc: { contact_merge_preview: { data: broken, error: null } } });
    await expect(contactMergePreview(db, "acct-1", "k1", "o1")).rejects.toThrow();
  });

  it("throws when seen.other is malformed too, not only seen.keep (symmetry check)", async () => {
    const broken = { ...okAnswer, seen: { keep: "a".repeat(32), other: "not-hex" } };
    const { db } = fakeDb({ rpc: { contact_merge_preview: { data: broken, error: null } } });
    await expect(contactMergePreview(db, "acct-1", "k1", "o1")).rejects.toThrow();
  });

  it("throws when fields.other is missing", async () => {
    const broken = { ...okAnswer, fields: { keep: { first_name: "Ana" } } };
    const { db } = fakeDb({ rpc: { contact_merge_preview: { data: broken, error: null } } });
    await expect(contactMergePreview(db, "acct-1", "k1", "o1")).rejects.toThrow();
  });

  it("throws on an RPC error", async () => {
    const { db } = fakeDb({ rpc: { contact_merge_preview: { data: null, error: { message: "boom" } } } });
    await expect(contactMergePreview(db, "acct-1", "k1", "o1")).rejects.toThrow("contactMergePreview failed: boom");
  });
});

describe("followMerge: merged_into when set, the id itself when null or no row; throws on an error", () => {
  it("returns merged_into when the row has one", async () => {
    const { db, fromCalls } = fakeDb({ from: { contacts: { data: { merged_into: "kept-1" }, error: null } } });
    expect(await followMerge(db, "acct-1", "tomb-1")).toBe("kept-1");
    expect(hasFrom(fromCalls, "contacts", "eq", "account_id", "acct-1")).toBe(true);
    expect(hasFrom(fromCalls, "contacts", "eq", "id", "tomb-1")).toBe(true);
  });

  it("returns the id itself when merged_into is null", async () => {
    const { db } = fakeDb({ from: { contacts: { data: { merged_into: null }, error: null } } });
    expect(await followMerge(db, "acct-1", "c1")).toBe("c1");
  });

  it("returns the id itself when there is no row at all", async () => {
    const { db } = fakeDb({ from: { contacts: { data: null, error: null } } });
    expect(await followMerge(db, "acct-1", "unknown-id")).toBe("unknown-id");
  });

  it("throws on a database error (mutation: swallow the error and return the id -> FAILS)", async () => {
    const { db } = fakeDb({ from: { contacts: { data: null, error: { message: "boom" } } } });
    await expect(followMerge(db, "acct-1", "c1")).rejects.toThrow("followMerge failed: boom");
  });
});

describe("mergedIdsOf: contacts filtered by merged_into AND account_id", () => {
  it("maps rows to ids, filtering on both merged_into and account_id (mutation: drop the account term -> FAILS)", async () => {
    const { db, fromCalls } = fakeDb({ from: { contacts: { data: [{ id: "t1" }, { id: "t2" }], error: null } } });
    const result = await mergedIdsOf(db, "acct-1", "keep-1");
    expect(result).toEqual(["t1", "t2"]);
    expect(hasFrom(fromCalls, "contacts", "eq", "account_id", "acct-1")).toBe(true);
    expect(hasFrom(fromCalls, "contacts", "eq", "merged_into", "keep-1")).toBe(true);
  });

  it("caps the read at 1000 rows — 0106 flattens chains to one hop, but a corrupt or adversarial account should never make this read unbounded (mutation: drop the .limit(1000) call -> FAILS)", async () => {
    const { db, fromCalls } = fakeDb({ from: { contacts: { data: [], error: null } } });
    await mergedIdsOf(db, "acct-1", "keep-1");
    expect(hasFrom(fromCalls, "contacts", "limit", 1000)).toBe(true);
  });

  it("returns an empty array when there are no tombstones", async () => {
    const { db } = fakeDb({ from: { contacts: { data: [], error: null } } });
    expect(await mergedIdsOf(db, "acct-1", "keep-1")).toEqual([]);
  });

  it("throws on a database error", async () => {
    const { db } = fakeDb({ from: { contacts: { data: null, error: { message: "boom" } } } });
    await expect(mergedIdsOf(db, "acct-1", "keep-1")).rejects.toThrow("mergedIdsOf failed: boom");
  });
});
