import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listContacts, countContacts, archiveContacts, restoreContacts, contactDeleteBlockers, deleteContacts } from "./contacts";

/** Every call on every query, and a fixed answer per table. Pure: the live behaviour is CI-only
 *  (src/test/contact-archive-live.test.ts). */
function recordingDb(answers: Record<string, unknown> = {}, rpc: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const chainFor = (table: string): unknown => {
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve({ data: answers[table] ?? [], error: null, count: 0 }).then(res, rej);
        }
        return (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      },
    });
    return chain;
  };
  const rpcAnswers: Record<string, unknown> = { ...rpc };
  const db = {
    from: (table: string) => chainFor(table),
    rpc: async (fn: string, args: unknown) => { rpcs.push({ fn, args }); return { data: rpcAnswers[fn] ?? null, error: null }; },
  } as unknown as SupabaseClient;
  return { db, calls, rpcs, rpcAnswers };
}
const has = (calls: { method: string; args: unknown[] }[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

describe("the archived filter, one rule for the list and its total", () => {
  it("listContacts leaves archived contacts out by default (mutation: drop `q = withArchived(q, opts.archived)` in listContacts -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await listContacts(db, "A");
    expect(has(calls, "is", "archived_at", null)).toBe(true);
  });
  it("countContacts does too, so the header total agrees (mutation: drop it in countContacts only -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await countContacts(db, "A");
    expect(has(calls, "is", "archived_at", null)).toBe(true);
  });
  it("the Archived view asks for archived ones only, in both (mutation: ignore `archived: \"only\"` -> FAILS)", async () => {
    const one = recordingDb(); await listContacts(one.db, "A", { archived: "only" });
    const two = recordingDb(); await countContacts(two.db, "A", { archived: "only" });
    for (const r of [one, two]) {
      expect(has(r.calls, "not", "archived_at", "is", null)).toBe(true);
      expect(has(r.calls, "is", "archived_at", null)).toBe(false);
    }
  });
});

describe("archiveContacts / restoreContacts", () => {
  it("archive touches only this account's active, non-holding rows and answers the ids it changed (mutation: drop `.is(\"archived_at\", null)` -> FAILS)", async () => {
    const { db, calls } = recordingDb({ contacts: [{ id: "c2" }] });
    const r = await archiveContacts(db, "A", ["c1", "c2"]);
    expect(r).toEqual({ changedIds: ["c2"] });
    expect(has(calls, "eq", "account_id", "A")).toBe(true);
    expect(has(calls, "eq", "holds_shared_number", false)).toBe(true);
    expect(has(calls, "is", "archived_at", null)).toBe(true);
  });
  it("restore touches only archived rows (mutation: drop the `.not` filter -> FAILS)", async () => {
    const { db, calls } = recordingDb({ contacts: [] });
    await restoreContacts(db, "A", ["c1"]);
    expect(has(calls, "not", "archived_at", "is", null)).toBe(true);
    expect(has(calls, "update", { archived_at: null })).toBe(true);
  });
  it("450 ids go in three .in() batches of at most 200 (review M1; mutation: one .in() of 450 -> FAILS)", async () => {
    const { db, calls } = recordingDb({ contacts: [] });
    await archiveContacts(db, "A", Array.from({ length: 450 }, (_, i) => `c${i}`));
    const ins = calls.filter((c) => c.method === "in").map((c) => (c.args[1] as string[]).length);
    expect(ins).toEqual([200, 200, 50]);
  });
  it("more than 500 ids is refused before any query (mutation: drop the cap -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await expect(archiveContacts(db, "A", Array.from({ length: 501 }, (_, i) => `c${i}`))).rejects.toThrow(/500/);
    expect(calls).toEqual([]);
  });
});

describe("contactDeleteBlockers", () => {
  it("maps one row per contact to its reasons (mutation: key by reason -> FAILS)", async () => {
    const { db } = recordingDb({}, { contact_delete_blockers: [{ contact_id: "c1", reasons: ["calls", "messages"] }] });
    const m = await contactDeleteBlockers(db, "A", ["c1", "c2"]);
    expect([...m]).toEqual([["c1", ["calls", "messages"]]]);
  });
});

describe("deleteContacts", () => {
  it("only proven ids reach the blockers, only unblocked ones reach beforeDelete, and the rest come back as skippedIds (mutation: pass the raw batch to delete_internal_contacts -> FAILS)", async () => {
    const request = recordingDb({ contacts: [{ id: "free" }, { id: "kept" }] });
    const service = recordingDb({}, {
      contact_delete_blockers: [{ contact_id: "kept", reasons: ["messages"] }],
    });
    request.rpcAnswers.delete_internal_contacts = ["free"];
    const seen: string[][] = [];
    const r = await deleteContacts(request.db, "A", ["free", "kept", "stranger"], {
      serviceDb: service.db, beforeDelete: async (ids) => { seen.push(ids); return []; },
    });
    expect(service.rpcs).toEqual([{ fn: "contact_delete_blockers", args: { p_account_id: "A", p_contact_ids: ["free", "kept"] } }]);
    expect(seen).toEqual([["free"]]);
    // On the REQUEST client, so the database's own Owner check runs (review I9; mutation: call it on serviceDb -> FAILS).
    expect(request.rpcs).toEqual([{ fn: "delete_internal_contacts", args: { p_account_id: "A", p_contact_ids: ["free"] } }]);
    expect(r).toEqual({ deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["kept"], lateKept: 0 });
  });
  it("an id the database kept after the purge is reported as lateKept and skipped (mutation: count every id sent as deleted -> FAILS)", async () => {
    const request = recordingDb({ contacts: [{ id: "a" }, { id: "b" }] }, { delete_internal_contacts: ["a"] });
    const service = recordingDb({}, { contact_delete_blockers: [] });
    const r = await deleteContacts(request.db, "A", ["a", "b"], { serviceDb: service.db });
    expect(r).toEqual({ deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["b"], lateKept: 1 });
  });
});
