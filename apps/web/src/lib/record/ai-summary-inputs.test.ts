import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@bis/db";
import {
  buildSummaryInputs, hasSomethingToSay, redactContactDetails, canonicalJson, inputDigest, localDay, localMinute, INPUT_LIMITS,
  type SummaryInputs,
} from "./ai-summary-inputs";

/** Item 8a-2 (spec 4.3, 4.4, 8.2; plan deviations 8-12). */
const A = "11111111-1111-4111-8111-111111111111";
const B = "33333333-3333-4333-8333-333333333333";
const C = "22222222-2222-4222-8222-222222222222";
const ZONE = "America/Chicago";
const NOW = new Date("2026-10-18T15:00:00Z");
const CONTACT = { id: C, first_name: "Ana", language: "es", created_at: "2025-12-02T18:00:00Z", source: "form: Contact us" };
type Call = { table: string; select: string | null; filters: [string, unknown[]][] };
type Answer = { data?: unknown; count?: number; error?: { message: string }; rows?: Record<string, unknown>[] };

/** `rows` (instead of `data`) makes the stand-in APPLY the read's eq / is / in / neq filters to those rows, the
 *  way PostgREST would, and answer the survivors (and their number as the count). That is what lets the
 *  second-account case put the OTHER account's matching rows in every table and see none come back. */
function applyFilters(rows: Record<string, unknown>[], filters: [string, unknown[]][]) {
  return rows.filter((row) => filters.every(([f, args]) => {
    const col = String(args[0]);
    if (!(col in row)) return true;
    if (f === "eq") return row[col] === args[1];
    if (f === "neq") return row[col] !== args[1];
    if (f === "is") return row[col] === args[1];
    if (f === "in") return (args[1] as unknown[]).includes(row[col]);
    return true;
  }));
}

function recordingDb(answers: Record<string, Answer> = {}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, select: null, filters: [] };
      calls.push(call);
      const proxy: unknown = new Proxy(() => {}, {
        get(_t, prop) {
          if (prop === "then") {
            const a = answers[table] ?? {};
            const single = call.filters.some(([f]) => f === "maybeSingle" || f === "single");
            let result: { data: unknown; error: { message: string } | null; count: number };
            if (a.rows) {
              const kept = applyFilters(a.rows, call.filters);
              result = { data: single ? kept[0] ?? null : kept, error: a.error ?? null, count: kept.length };
            } else {
              result = { data: a.data ?? (single ? null : []), error: a.error ?? null, count: a.count ?? 0 };
            }
            return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
          }
          return (...args: unknown[]) => {
            if (prop === "select") call.select = String(args[0]);
            else call.filters.push([String(prop), args]);
            return proxy;
          };
        },
      });
      return proxy;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}
// One conversation by default: with none, contactFacts' newestConversationMessage (record.ts:58-64) stops
// before it reads `messages`, and the no-bodies probe would never see the messages read it pins.
const build = (answers?: Parameters<typeof recordingDb>[0]) => {
  const r = recordingDb({ conversations: { data: { id: "v1" } }, ...answers });
  return { r, p: buildSummaryInputs(r.db, { accountId: A, contact: CONTACT, zone: ZONE, now: NOW }) };
};

describe("the builder reads only team-visible facts (spec 4.3)", () => {
  it("never reads a body: the tables are exactly these, messages and conversations select only the last-talked columns, notes and chats are never read (plan deviation 10; mutations: add a notes read -> FAILS; select messages 'body' -> FAILS)", async () => {
    const { r, p } = build();
    await p;
    const tables = [...new Set(r.calls.map((c) => c.table))].sort();
    expect(tables).toEqual(["bookings", "calls", "conversations", "documents", "messages", "opportunities", "tasks"]);
    expect(r.calls.filter((c) => c.table === "messages").map((c) => c.select)).toEqual(["channel, created_at"]);
    expect(r.calls.filter((c) => c.table === "conversations").map((c) => c.select)).toEqual(["id"]);
    for (const c of r.calls) expect([c.table, c.select ?? ""]).not.toEqual([c.table, expect.stringMatching(/\b(body|subject|content|transcript)\b/)]);
  });

  it("the output has no field that could hold a message, a note or a chat (mutation: add `messages: []` to the result -> FAILS)", async () => {
    const { p } = build();
    expect(Object.keys(await p).sort()).toEqual(["bookings", "calls", "deals", "documents", "facts", "nextBooking", "todos", "who"]);
  });

  it("every read is this account's (second-account case; mutation: drop .eq('account_id', accountId) from any one read -> FAILS naming its table)", async () => {
    const { r, p } = build();
    await p;
    const missing = r.calls.filter((c) => !c.filters.some(([f, args]) => f === "eq" && args[0] === "account_id" && args[1] === A)).map((c) => c.table);
    expect(missing).toEqual([]);
  });

  it("the OTHER account's rows for the same contact id never reach the inputs, in any table (second-account case with matching rows; mutation: drop .eq('account_id', accountId) from the tasks read -> FAILS)", async () => {
    // Same contact id, every other column matching, only account_id differs: an absent account filter lets it through.
    const other = { account_id: B, contact_id: C };
    const r = recordingDb({
      bookings: { rows: [{ ...other, id: "b1", starts_at: "2026-10-20T15:00:00Z", status: "booked", rescheduled_from_id: null }] },
      opportunities: { rows: [{ ...other, name: "Other deal", monetary_value: "99", stage_id: "s9", status: "open" }] },
      pipeline_stages: { rows: [{ account_id: B, id: "s9", name: "Other stage" }] },
      tasks: { rows: [{ ...other, title: "Other to-do", due_at: null, completed_at: null }] },
      documents: { rows: [{ ...other, title: "Other file", category: "other", owners_only: false, deleted_at: null }] },
      calls: { rows: [{ ...other, id: "k9", started_at: "2026-10-17T20:00:00Z", outcome: "booked", duration_secs: 60, reason: null, summary: "Other call", language: "en" }] },
      conversations: { rows: [{ ...other, id: "v9" }] },
      messages: { rows: [{ account_id: B, conversation_id: "v9", channel: "sms", created_at: "2026-10-16T20:00:00Z", status: "sent" }] },
    });
    const i = await buildSummaryInputs(r.db, { accountId: A, contact: CONTACT, zone: ZONE, now: NOW });
    expect(i.facts).toEqual({ bookingsMade: 0, lastTalked: null, openDeals: { count: 0, amount: 0 } });
    expect([i.bookings, i.nextBooking, i.deals, i.todos, i.documents, i.calls]).toEqual([[], null, [], [], [], []]);
    expect(hasSomethingToSay(i)).toBe(false);
    // The stand-in is not vacuous: the same rows under THIS account do come back.
    const mine = recordingDb({ tasks: { rows: [{ account_id: A, contact_id: C, title: "Mine", due_at: null, completed_at: null }] } });
    expect((await buildSummaryInputs(mine.db, { accountId: A, contact: CONTACT, zone: ZONE, now: NOW })).todos).toEqual([{ title: "Mine", due: null }]);
  });

  it("documents: live files only, never Owners-only (G7; mutations: drop .eq('owners_only', false) -> FAILS; drop .is('deleted_at', null) -> FAILS)", async () => {
    const { r, p } = build();
    await p;
    const doc = r.calls.find((c) => c.table === "documents")!;
    expect(doc.select).toBe("title, category");
    expect(doc.filters).toContainEqual(["eq", ["owners_only", false]]);
    expect(doc.filters).toContainEqual(["is", ["deleted_at", null]]);
    expect(doc.filters).toContainEqual(["eq", ["contact_id", C]]);
  });

  it("open To-dos only, open deals only (mutations: drop .is('completed_at', null) -> FAILS; drop .eq('status', 'open') -> FAILS)", async () => {
    const { r, p } = build();
    await p;
    expect(r.calls.find((c) => c.table === "tasks")!.filters).toContainEqual(["is", ["completed_at", null]]);
    expect(r.calls.find((c) => c.table === "opportunities" && c.select === "name, monetary_value, stage_id")!.filters).toContainEqual(["eq", ["status", "open"]]);
  });

  it("any failed read fails the whole build (plan deviation 11; mutation: swallow the tasks error -> resolves -> FAILS)", async () => {
    await expect(build({ tasks: { error: { message: "boom" } } }).p).rejects.toThrow(/tasks/);
    await expect(build({ messages: { error: { message: "boom" } } }).p).rejects.toThrow(/facts/);
  });

  it("a deal carries its stage's name, read only when there is a deal (mutation: drop the stage read and send stage: null -> FAILS)", async () => {
    const { r, p } = build({
      opportunities: { data: [{ name: "Fence", monetary_value: "1200.50", stage_id: "s1" }] },
      pipeline_stages: { data: [{ id: "s1", name: "Quote sent" }] },
    });
    const i = await p;
    expect(i.deals).toEqual([{ name: "Fence", stage: "Quote sent", amount: 1200.5 }]);
    expect([...new Set(r.calls.map((c) => c.table))].sort()).toEqual(
      ["bookings", "calls", "conversations", "documents", "messages", "opportunities", "pipeline_stages", "tasks"]);
    const stage = r.calls.find((c) => c.table === "pipeline_stages")!;
    expect(stage.select).toBe("id, name");
    expect(stage.filters).toContainEqual(["in", ["id", ["s1"]]]);
  });
});

describe("what the model is given (spec 4.3; I6)", () => {
  it("first name only, local dates, bounded lists and cut texts (mutations: send last_name -> FAILS; cut title at 200 -> FAILS; drop the bookings limit -> FAILS)", async () => {
    const long = "T".repeat(300);
    const { r, p } = build({
      bookings: { data: [{ starts_at: "2026-10-20T15:00:00Z", status: "booked" }] },
      tasks: { data: [{ title: long, due_at: "2026-10-19T04:30:00Z" }] },
      documents: { data: [{ title: "Insurance card", category: "insurance" }] },
      calls: { data: [{ id: "k1", contact_id: C, started_at: "2026-10-17T20:00:00Z", outcome: "booked", duration_secs: 60, reason: null, summary: "Wants a quote. Call (956) 555-0100 or ana.g@example.com.", language: "es" }] },
    });
    const i = await p;
    expect(i.who).toEqual({ firstName: "Ana", language: "es", since: "2025-12", source: "form: Contact us" });
    expect(i.todos).toEqual([{ title: "T".repeat(120), due: "2026-10-18" }]);
    expect(i.documents).toEqual([{ title: "Insurance card", category: "insurance" }]);
    expect(i.calls).toEqual([{ on: "2026-10-17", outcome: "booked", summary: "Wants a quote. Call [number] or [email]." }]);
    expect(i.bookings[0]).toEqual({ at: "2026-10-20 10:00", status: "booked" });
    expect(r.calls.find((c) => c.table === "bookings" && c.select === "starts_at, status")!.filters).toContainEqual(["limit", [INPUT_LIMITS.bookings]]);
    expect(JSON.stringify(i)).not.toMatch(/Garcia|555-0100|example\.com/);
  });

  it("redacts phones and emails in call summaries and keeps dates, times, amounts and short numbers (I6; mutation: drop the digit-count test -> '2026-10-14' is redacted -> FAILS)", () => {
    expect(redactContactDetails("Call me at (956) 555-0100 or +1 956 555 0100, or ana.g@example.com, on 2026-10-14 for $1,200 at 10:30. Ref 12345."))
      .toBe("Call me at [number] or [number], or [email], on 2026-10-14 for $1,200 at 10:30. Ref 12345.");
  });

  it("every free text is redacted, not only call summaries: To-do titles, deal names, document titles and the source (plan fix M4; mutation: redact only call summaries -> FAILS)", async () => {
    const i = await build({
      tasks: { data: [{ title: "Call back on 956-555-0100", due_at: null }] },
      opportunities: { data: [{ name: "Quote for ana.g@example.com", monetary_value: "10", stage_id: "s1" }] },
      pipeline_stages: { data: [{ id: "s1", name: "New" }] },
      documents: { data: [{ title: "ID 956 555 0100", category: "id" }] },
    }).p;
    expect([i.todos[0]!.title, i.deals[0]!.name, i.documents[0]!.title]).toEqual(["Call back on [number]", "Quote for [email]", "ID [number]"]);
    const r2 = recordingDb({ conversations: { data: { id: "v1" } } });
    const j = await buildSummaryInputs(r2.db, { accountId: A, contact: { ...CONTACT, source: "referral from +1 956 555 0100" }, zone: ZONE, now: NOW });
    expect(j.who.source).toBe("referral from [number]");
  });

  it("local dates in the account's zone (mutation: format in UTC -> the 04:30Z due date reads 2026-10-19 -> FAILS)", () => {
    expect([localDay("2026-10-19T04:30:00Z", ZONE), localMinute("2026-10-20T15:00:00Z", ZONE)]).toEqual(["2026-10-18", "2026-10-20 10:00"]);
  });

  it("nothing to say: no booking, deal, To-do, document or call summary (spec 4.3; mutation: count the facts line -> FAILS)", () => {
    const empty: SummaryInputs = {
      who: { firstName: "Ana", language: null, since: "2025-12", source: null },
      facts: { bookingsMade: 3, lastTalked: { channel: "text", on: "2026-10-01" }, openDeals: { count: 0, amount: 0 } },
      bookings: [], nextBooking: null, deals: [], todos: [], documents: [], calls: [{ on: "2026-10-01", outcome: "abandoned", summary: "" }],
    };
    expect(hasSomethingToSay(empty)).toBe(false);
    expect(hasSomethingToSay({ ...empty, documents: [{ title: "W-9", category: "other" }] })).toBe(true);
  });
});

describe("the digest (spec 4.4)", () => {
  const base: SummaryInputs = {
    who: { firstName: "Ana", language: null, since: "2025-12", source: null },
    facts: { bookingsMade: 1, lastTalked: null, openDeals: { count: 0, amount: 0 } },
    bookings: [{ at: "2026-10-20 10:00", status: "booked" }], nextBooking: null, deals: [], todos: [], documents: [], calls: [],
  };
  it("is stable under key order, and changes when any input or the version changes (mutations: JSON.stringify without sorting -> the reordered object differs -> FAILS; leave the version out -> FAILS)", () => {
    const reordered = JSON.parse(JSON.stringify({ calls: base.calls, todos: base.todos, documents: base.documents, deals: base.deals, nextBooking: base.nextBooking, bookings: base.bookings, facts: base.facts, who: base.who })) as SummaryInputs;
    expect(inputDigest(reordered, 1)).toBe(inputDigest(base, 1));
    expect(inputDigest(base, 1)).toMatch(/^[0-9a-f]{64}$/);
    expect(inputDigest({ ...base, todos: [{ title: "Send quote", due: null }] }, 1)).not.toBe(inputDigest(base, 1));
    expect(inputDigest(base, 2)).not.toBe(inputDigest(base, 1));
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});
