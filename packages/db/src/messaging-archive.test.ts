import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listConversations, searchConversations, sumUnreadCount } from "./messaging";

/** Every call on every query, and a fixed answer per table. Pure: the live behaviour is CI-only
 *  (src/test/messaging-archive-live.test.ts). Copied from contacts-archive.test.ts's `recordingDb` (T4
 *  Step 1); files stay disjoint. */
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

describe("an archived contact's thread leaves the inbox and search while nothing in it is unread (review I8)", () => {
  it("listConversations keeps only inbox_visible threads, with or without Mine (mutation: drop the filter -> FAILS)", async () => {
    for (const opts of [{}, { assignee: { who: "mine" as const, userId: "u1" } }]) {
      const { db, calls } = recordingDb();
      await listConversations(db, "A", opts);
      expect(has(calls, "eq", "inbox_visible", true)).toBe(true);
    }
  });
  it("searchConversations filters BEFORE its five-thread cap: the messages read itself joins visible threads (M2; mutation: filter only the second read -> FAILS)", async () => {
    const { db, calls } = recordingDb({ messages: [] });
    await searchConversations(db, "A", { search: "roof" });
    const msgSelect = calls.find((c) => c.table === "messages" && c.method === "select");
    expect(String(msgSelect?.args[0])).toContain("conversations!inner(inbox_visible)");
    expect(calls.some((c) => c.table === "messages" && c.method === "eq"
      && JSON.stringify(c.args) === JSON.stringify(["conversations.inbox_visible", true]))).toBe(true);
  });
  it("sumUnreadCount is NOT filtered: an archived contact's unread customer text still counts (mutation: add an archive filter -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await sumUnreadCount(db, "A");
    expect(calls.some((c) => JSON.stringify(c.args).includes("archived") || JSON.stringify(c.args).includes("inbox_visible"))).toBe(false);
  });
});
