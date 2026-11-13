import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createContact, fillContactBlanksReport } from "./contacts";
import { insertAiActs } from "./ai-acts";
import { AUTHOR_HEADER } from "./row-author";
import type { NewAiAct } from "./ai-act-rules";

/**
 * F-115 (plan Task 2 Step 7): a contact write Sofía makes names the act it logs, `via: ai_act:<id>`, and the act
 * is inserted under that SAME id. Three seams make that possible, each pinned here: createContact and
 * fillContactBlanksReport put the via on the x-bis-author header, and insertAiActs keeps a caller's own id. Pure;
 * a hand-built client records what each request would have carried.
 */

type Sent = { table: string; op: string; payload: unknown; headers: Record<string, string> };

function recordingDb(contact: Record<string, unknown> | null) {
  const sent: Sent[] = [];
  const db = {
    from(table: string) {
      const read = {
        select: () => read, eq: () => read, is: () => read, neq: () => read, in: () => read,
        order: () => Promise.resolve({ data: [], error: null }),
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: table === "contacts" ? contact : null, error: null }),
      };
      const write = (op: string, payload: unknown) => {
        const entry: Sent = { table, op, payload, headers: {} };
        sent.push(entry);
        const b = {
          setHeader: (n: string, v: string) => { entry.headers[n] = v; return b; },
          eq: () => b,
          select: () => b,
          single: () => Promise.resolve({ data: { id: "new-1" }, error: null }),
          then: (res: (v: { data: null; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(res, rej),
        };
        return b;
      };
      return {
        ...read,
        insert: (payload: unknown) => write("insert", payload),
        update: (payload: unknown) => write("update", payload),
      };
    },
  };
  return { db: db as unknown as SupabaseClient, sent };
}

const AI = { authorKind: "ai" as const, authorId: null };
const header = (s: Sent | undefined) => JSON.parse(s?.headers[AUTHOR_HEADER] ?? "null");

describe("F-115: Sofía's contact writes carry their act id", () => {
  it("createContact sends input.via on the insert's author header (mutation: drop input.via from withAuthor -> FAILS)", async () => {
    const { db, sent } = recordingDb(null);
    await createContact(db, "a1", { firstName: "Caller", phone: "+19565550196", source: "voice", via: "ai_act:act-1" }, "voice", "ai");
    const insert = sent.find((s) => s.table === "contacts" && s.op === "insert");
    expect(header(insert)).toEqual({ kind: "ai", via: "ai_act:act-1" });
    // The via is a header, never a column.
    expect(insert?.payload).not.toHaveProperty("via");
  });

  it("fillContactBlanksReport sends its via on the update's author header (mutation: drop via from withAuthor -> FAILS)", async () => {
    const { db, sent } = recordingDb({ id: "c1", first_name: "Caller", last_name: null, email: null, phone: "+19565550196", merged_into: null });
    const filled = await fillContactBlanksReport(db, "a1", "c1", { firstName: "Ana" }, AI, "ai_act:act-2");
    expect(filled.written).toEqual({ firstName: "Ana" });
    expect(header(sent.find((s) => s.table === "contacts" && s.op === "update"))).toEqual({ kind: "ai", via: "ai_act:act-2" });
  });

  it("insertAiActs keeps a caller's own act id, and gives every other row of the batch one too (mutation: drop id from toRow -> FAILS)", async () => {
    const { db, sent } = recordingDb(null);
    const base = { actor: "voice" as const, callId: "call-1", chatId: null, contactId: "c1" };
    const acts: NewAiAct[] = [
      { ...base, id: "11111111-1111-4111-8111-111111111111", kind: "contact_created", target: {}, before: null, after: null },
      { ...base, kind: "booking_created", target: { bookingId: "b1" }, before: null, after: { startsAt: "s", endsAt: "e" } },
    ];
    await insertAiActs(db, "a1", acts);
    const rows = sent.find((s) => s.table === "ai_acts")?.payload as { id?: unknown }[];
    expect(rows[0]!.id).toBe("11111111-1111-4111-8111-111111111111");
    // supabase-js fills a key missing from one row of a bulk insert with NULL (defaultToNull), and a NULL
    // primary key is a 23502: a row without its own id gets a fresh one here, never a missing key.
    expect(rows[1]!.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(rows[1]!.id).not.toBe(rows[0]!.id);
  });
});
