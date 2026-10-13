import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMessage, listContactMessages } from "../messaging";

/**
 * The same two promises as messaging-author.test.ts (live, proven on CI's in-runner stack, which
 * has 0073), checked here with no database so they can fail locally by name: what createMessage
 * sends, and what the record's page read asks PostgREST for. A fake client records each call.
 */
function fakeDb() {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const chain = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "insert", "update", "eq", "in", "or", "order", "limit"]) {
      b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return b; };
    }
    b.single = async () => ({ data: { id: "m1" }, error: null });
    b.maybeSingle = async () => ({ data: { id: "conv1" }, error: null });
    // Task 12 made the conversations read an awaited ARRAY (a set of members' conversations), so it
    // answers one conversation here; every other awaited read is empty (final review I2).
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === "conversations" ? [{ id: "conv1", contact_id: "c1" }] : [], error: null }).then(res, rej);
    return b;
  };
  const db = { from: (table: string) => chain(table), rpc: async () => ({ data: null, error: null }) };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("createMessage sends its author (S-03 1b, no database)", () => {
  it("an outbound text a person sent carries author_kind 'person' and their id (mutation: drop author_kind/author_id from the insert -> FAILS)", async () => {
    const { db, calls } = fakeDb();
    await createMessage(db, "a1", { conversationId: "conv1", channel: "sms", direction: "outbound", body: "x" }, "user_dan", "user");
    const insert = calls.find((c) => c.table === "messages" && c.op === "insert");
    expect(insert?.args[0]).toMatchObject({ author_kind: "person", author_id: "user_dan" });
  });

  it("an inbound message is the customer's, with no id (mutation: pass 'outbound' to messageAuthor -> FAILS)", async () => {
    const { db, calls } = fakeDb();
    await createMessage(db, "a1", { conversationId: "conv1", channel: "sms", direction: "inbound", body: "x" }, "sms-inbound", "system");
    const insert = calls.find((c) => c.table === "messages" && c.op === "insert");
    expect(insert?.args[0]).toMatchObject({ author_kind: "customer", author_id: null });
  });
});

describe("listContactMessages' page read (S-03 1b, spec C4, no database)", () => {
  it("asks for the author pair and only the channels given (mutation: drop the channel filter, or the author columns from the select -> FAILS)", async () => {
    const { db, calls } = fakeDb();
    await listContactMessages(db, "a1", "c1", { limit: 31, channels: ["email", "sms"] });
    const msg = calls.filter((c) => c.table === "messages");
    const cols = String(msg.find((c) => c.op === "select")?.args[0]).split(",").map((s) => s.trim());
    expect(cols).toEqual(expect.arrayContaining(["author_kind", "author_id", "channel", "created_at"]));
    // Task 12: the member's conversations are read as a set, so messages filter on .in(conversation_id).
    expect(msg.filter((c) => c.op === "in")).toEqual(expect.arrayContaining([
      { table: "messages", op: "in", args: ["channel", ["email", "sms"]] },
      { table: "messages", op: "in", args: ["conversation_id", ["conv1"]] },
    ]));
    expect(msg.filter((c) => c.op === "in")).toHaveLength(2);
    expect(msg.filter((c) => c.op === "limit").map((c) => c.args[0])).toEqual([31]);
  });

  it("with no page, today's read: no author columns, no channel filter, oldest first (mutation: always page -> FAILS)", async () => {
    const { db, calls } = fakeDb();
    await listContactMessages(db, "a1", "c1");
    const msg = calls.filter((c) => c.table === "messages");
    expect(String(msg.find((c) => c.op === "select")?.args[0])).not.toContain("author_kind");
    expect(msg.filter((c) => c.op === "in")).toEqual([]);
    expect(msg.filter((c) => c.op === "order")).toEqual([{ table: "messages", op: "order", args: ["created_at", { ascending: true }] }]);
  });
});
