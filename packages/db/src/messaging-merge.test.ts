import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureConversation, incrementUnreadForMessage } from "./messaging";
import { findReplyThread, matchSender } from "./inbound-email";

/**
 * Task 7 (F-006), pure half: threads and mail after a merge — `ensureConversation`'s pointer follow,
 * `incrementUnreadForMessage`'s fresh-read bump, `matchSender`'s merged-away match, and
 * `findReplyThread`'s `contact_merges.other_reply_token` fallback. No database — a fake client answers
 * each `.from(table)` call with the NEXT entry queued for that table (falling back to the last one), so a
 * function that runs more than one distinct query against the same table within one call can be given a
 * different answer for each. `rpc` calls are recorded the same way `contact-merge.test.ts` records them.
 * The live half (CI only; 0106 is not on bis-ci) is `test/messaging-merge-live.test.ts`.
 */
type Answer = { data: unknown; error: unknown };
function recordingDb(responses: Record<string, Answer[]> = {}, rpc: Record<string, Answer[]> = {}) {
  const calls: { table: string; method: string; args: unknown[]; call: number }[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const nextIndex: Record<string, number> = {};
  let callCounter = 0;
  const db = {
    from: (table: string) => {
      const call = callCounter++;
      const idx = nextIndex[table] ?? 0;
      nextIndex[table] = idx + 1;
      const list = responses[table] ?? [];
      const answer: Answer = list[idx] ?? list[list.length - 1] ?? { data: null, error: null };
      const chain: unknown = new Proxy({}, {
        get(_t, method: string) {
          if (method === "then") {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(answer).then(res, rej);
          }
          return (...args: unknown[]) => { calls.push({ table, method, args, call }); return chain; };
        },
      });
      return chain;
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      const n = rpcCalls.filter((c) => c.name === name).length - 1;
      const list = rpc[name] ?? [];
      const answer = list[n] ?? list[list.length - 1] ?? { data: null, error: null };
      return Promise.resolve(answer);
    },
  } as unknown as SupabaseClient;
  return { db, calls, rpcCalls };
}
const has = (calls: { table: string; method: string; args: unknown[] }[], table: string, method: string, ...args: unknown[]) =>
  calls.some((c) => c.table === table && c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

describe("ensureConversation: a miss follows the merge pointer before anything is created (0106, owner ruling D8)", () => {
  it("T misses its own thread, followMerge answers K, K's thread is found — no insert, created: false (mutation: insert for T after the miss → an insert is recorded, FAILS)", async () => {
    const { db, calls } = recordingDb({
      conversations: [
        { data: null, error: null },                 // T's own thread: a miss
        { data: { id: "conv-K" }, error: null },      // K's thread, after following the pointer: found
      ],
      contacts: [{ data: { merged_into: "K" }, error: null }], // followMerge(T) -> K
    });
    const result = await ensureConversation(db, "A", "T", "user_test");
    expect(result).toEqual({ id: "conv-K", created: false });
    expect(calls.some((c) => c.table === "conversations" && c.method === "insert")).toBe(false);
    expect(has(calls, "conversations", "eq", "contact_id", "K")).toBe(true);
    expect(has(calls, "conversations", "eq", "contact_id", "T")).toBe(true); // the first (missed) read only
  });

  it("the hot path (a thread already there for the id asked) issues no contacts read at all (mutation: resolve first → an extra read, FAILS)", async () => {
    const { db, calls } = recordingDb({
      conversations: [{ data: { id: "conv-T" }, error: null }],
    });
    const result = await ensureConversation(db, "A", "T", "user_test");
    expect(result).toEqual({ id: "conv-T", created: false });
    expect(calls.some((c) => c.table === "contacts")).toBe(false);
  });

  it("when K also has no thread, the insert and the emitted event both target K, never T", async () => {
    const { db, calls } = recordingDb({
      conversations: [
        { data: null, error: null },                  // T's own thread: a miss
        { data: null, error: null },                  // K's thread: also a miss
        { data: { id: "conv-K-new" }, error: null },   // the insert's own .select("id").single()
      ],
      contacts: [{ data: { merged_into: "K" }, error: null }],
      events: [{ data: null, error: null }],
    });
    const result = await ensureConversation(db, "A", "T", "user_test", "system");
    expect(result).toEqual({ id: "conv-K-new", created: true });
    expect(has(calls, "conversations", "insert", { account_id: "A", contact_id: "K" })).toBe(true);
    expect(calls.some((c) => c.table === "conversations" && c.method === "insert" &&
      JSON.stringify(c.args).includes("\"T\""))).toBe(false);
    const eventCall = calls.find((c) => c.table === "events" && c.method === "insert");
    expect(eventCall?.args[0]).toMatchObject({ type: "conversation.created", payload: { contactId: "K" } });
  });

  it("an unmerged contact (followMerge answers itself) still inserts normally, exactly as before", async () => {
    const { db, calls } = recordingDb({
      conversations: [
        { data: null, error: null },
        { data: { id: "conv-new" }, error: null },
      ],
      contacts: [{ data: { merged_into: null }, error: null }],
      events: [{ data: null, error: null }],
    });
    const result = await ensureConversation(db, "A", "T", "user_test");
    expect(result).toEqual({ id: "conv-new", created: true });
    expect(has(calls, "conversations", "insert", { account_id: "A", contact_id: "T" })).toBe(true);
  });
});

describe("incrementUnreadForMessage: reads the message's OWN conversation fresh, then bumps THAT thread", () => {
  it("bumps the conversation the message currently sits on (mutation: bump the caller-remembered conversation instead → the rpc call's own args would name the wrong id, FAILS)", async () => {
    const { db, calls, rpcCalls } = recordingDb(
      { messages: [{ data: { conversation_id: "conv-K" }, error: null }] },
      { increment_conversation_unread: [{ data: null, error: null }] },
    );
    await incrementUnreadForMessage(db, "A", "m1");
    expect(has(calls, "messages", "eq", "account_id", "A")).toBe(true);
    expect(has(calls, "messages", "eq", "id", "m1")).toBe(true);
    expect(rpcCalls[0]).toEqual({ name: "increment_conversation_unread", args: { p_account_id: "A", p_conversation_id: "conv-K" } });
  });

  it("THROWS when the message cannot be found, rather than returning quietly (mutation: return on a miss → FAILS)", async () => {
    const { db } = recordingDb({ messages: [{ data: null, error: null }] });
    await expect(incrementUnreadForMessage(db, "A", "gone")).rejects.toThrow("no message gone");
  });

  it("throws on a read error", async () => {
    const { db } = recordingDb({ messages: [{ data: null, error: { message: "boom" } }] });
    await expect(incrementUnreadForMessage(db, "A", "m1")).rejects.toThrow("incrementUnreadForMessage failed: boom");
  });
});

describe("matchSender: a merged-away record's own address still matches the kept contact (0106, owner ruling D8)", () => {
  it("K's own email_key differs, but a tombstone pointing at K with the matched address answers K's own name, viaGroup false (mutation: drop that read → null, the mail would be held, FAILS)", async () => {
    const { db, calls } = recordingDb({
      contacts: [
        { data: { id: "K", first_name: "Keep", last_name: "Kept", email_key: "current@x.mx" }, error: null }, // self
        { data: { id: "T" }, error: null }, // the merged-away match
      ],
    });
    const result = await matchSender(db, "A", "K", "old@x.mx");
    expect(result).toEqual({ contactId: "K", firstName: "Keep", lastName: "Kept", viaGroup: false });
    expect(has(calls, "contacts", "eq", "merged_into", "K")).toBe(true);
  });

  it("no tombstone and no group member matching: null, as before", async () => {
    const { db } = recordingDb({
      contacts: [
        { data: { id: "K", first_name: "Keep", last_name: "Kept", email_key: "current@x.mx" }, error: null },
        { data: null, error: null },
      ],
      client_group_members: [{ data: [], error: null }],
    });
    expect(await matchSender(db, "A", "K", "stranger@x.mx")).toBeNull();
  });

  it("throws on a read error on the merged-away check", async () => {
    const { db } = recordingDb({
      contacts: [
        { data: { id: "K", first_name: "Keep", last_name: "Kept", email_key: "current@x.mx" }, error: null },
        { data: null, error: { message: "boom" } },
      ],
    });
    await expect(matchSender(db, "A", "K", "old@x.mx")).rejects.toThrow("matchSender merged-away read failed: boom");
  });
});

describe("findReplyThread: a merge's own other_reply_token is the backstop once the token's own thread is gone (0106, correction 7, owner ruling D8)", () => {
  it("no conversation holds the token; contact_merges answers K; followMerge(K) = K; K's thread answers the kept thread (mutation: drop the fallback → null, the reply would be lost, FAILS)", async () => {
    const { db, calls } = recordingDb({
      conversations: [
        { data: null, error: null },   // the primary lookup by reply_token: a miss
        { data: { id: "conv-K", accounts: { inbound_domain: "mail.example.com" } }, error: null }, // K's own thread
      ],
      contact_merges: [{ data: { account_id: "A", keep_id: "K" }, error: null }],
      contacts: [{ data: { merged_into: null }, error: null }], // followMerge(K) = K
    });
    const result = await findReplyThread(db, "bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result).toEqual({ conversationId: "conv-K", accountId: "A", contactId: "K", revoked: false, inboundDomain: "mail.example.com" });
    expect(has(calls, "contact_merges", "is", "undone_at", null)).toBe(true);
  });

  it("filters contact_merges on is(\"undone_at\", null) — the fake client cannot simulate a real WHERE, so the ONLY thing that can catch a dropped filter is the recorded call itself (mutation: drop is(\"undone_at\", null) → this assertion FAILS)", async () => {
    const { db, calls } = recordingDb({
      conversations: [{ data: null, error: null }],
      contact_merges: [{ data: null, error: null }],
    });
    expect(await findReplyThread(db, "bbbbbbbbbbbbbbbbbbbbbbbb")).toBeNull();
    expect(has(calls, "contact_merges", "is", "undone_at", null)).toBe(true);
  });

  it("no merge carries the token either: null", async () => {
    const { db } = recordingDb({
      conversations: [{ data: null, error: null }],
      contact_merges: [{ data: null, error: null }],
    });
    expect(await findReplyThread(db, "bbbbbbbbbbbbbbbbbbbbbbbb")).toBeNull();
  });

  it("the live token's own thread (no merge involved) never reaches contact_merges at all", async () => {
    const { db, calls } = recordingDb({
      conversations: [{
        data: { id: "conv-T", account_id: "A", contact_id: "T", reply_token_revoked_at: null, accounts: { inbound_domain: null } },
        error: null,
      }],
    });
    const result = await findReplyThread(db, "bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result).toEqual({ conversationId: "conv-T", accountId: "A", contactId: "T", revoked: false, inboundDomain: null });
    expect(calls.some((c) => c.table === "contact_merges")).toBe(false);
  });
});
