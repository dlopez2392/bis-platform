import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@bis/db";
import { expiryTaskTitle } from "@/lib/documents/expiry-task";
import {
  buildSummaryInputs, hasSomethingToSay, redactContactDetails, redactName, canonicalJson, inputDigest, localDay, localMinute, INPUT_LIMITS,
  type SummaryInputs,
} from "./ai-summary-inputs";

/** Item 8a-2 (spec 4.3, 4.4, 8.2; plan deviations 8-12). */
const A = "11111111-1111-4111-8111-111111111111";
const B = "33333333-3333-4333-8333-333333333333";
const C = "22222222-2222-4222-8222-222222222222";
const ZONE = "America/Chicago";
const NOW = new Date("2026-10-18T15:00:00Z");
const CONTACT = { id: C, first_name: "Ana", last_name: "Garcia", language: "es", created_at: "2025-12-02T18:00:00Z", source: "form: Contact us" };
const CALL_COLS = "id, contact_id, started_at, outcome, duration_secs, reason, summary, language";
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

/** `fail` answers an error to exactly the reads it matches, so one read of a table can fail while the others succeed. */
function recordingDb(answers: Record<string, Answer> = {}, fail?: (c: Call) => boolean) {
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
            const error = fail?.(call) ? { message: "boom" } : a.error ?? null;
            let result: { data: unknown; error: { message: string } | null; count: number };
            if (a.rows) {
              const kept = applyFilters(a.rows, call.filters);
              result = { data: single ? kept[0] ?? null : kept, error, count: kept.length };
            } else {
              result = { data: a.data ?? (single ? null : []), error, count: a.count ?? 0 };
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
const build = (answers?: Record<string, Answer>, fail?: (c: Call) => boolean) => {
  const r = recordingDb({ conversations: { data: { id: "v1" } }, ...answers }, fail);
  return { r, p: buildSummaryInputs(r.db, { accountId: A, contact: CONTACT, zone: ZONE, now: NOW }) };
};
/** A deal is present, so the stage read runs too: every read the builder can make is made. */
const DEAL: Record<string, Answer> = {
  opportunities: { data: [{ name: "Fence", monetary_value: "1200.50", stage_id: "s1" }] },
  pipeline_stages: { data: [{ id: "s1", name: "Quote sent" }] },
};
const has = (c: Call, f: string) => c.filters.some(([x]) => x === f);
const limitOf = (c: Call) => c.filters.find(([f]) => f === "limit")?.[1][0];
const isNext = (c: Call) => c.table === "bookings" && has(c, "gte");
const isBookingList = (c: Call) => c.table === "bookings" && c.select === "starts_at, status" && !has(c, "gte");
const isDealList = (c: Call) => c.table === "opportunities" && c.select === "name, monetary_value, stage_id";

describe("the builder reads only team-visible facts (spec 4.3)", () => {
  it("never reads a body: every read is exactly one of these (table, columns), notes and chats are never read (plan deviation 10; review I5; mutations: add a notes read -> FAILS; select('*') on calls, tasks or open deals -> FAILS)", async () => {
    const { r, p } = build(DEAL);
    await p;
    const reads = r.calls.map((c) => [c.table, c.select]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    expect(reads).toEqual([
      ["bookings", "id"],
      ["bookings", "starts_at, status"],
      ["bookings", "starts_at, status"],
      ["calls", CALL_COLS],
      ["calls", CALL_COLS],
      ["conversations", "id"],
      ["documents", "title, category"],
      ["messages", "channel, created_at"],
      ["opportunities", "monetary_value"],
      ["opportunities", "name, monetary_value, stage_id"],
      ["pipeline_stages", "id, name"],
      ["tasks", "title, due_at"],
    ]);
    for (const c of r.calls) expect([c.table, c.select ?? ""]).not.toEqual([c.table, expect.stringMatching(/\b(body|subject|content|transcript)\b|\*/)]);
  });

  it("with no deal, the stage read does not run", async () => {
    const { r, p } = build();
    await p;
    expect([...new Set(r.calls.map((c) => c.table))].sort()).toEqual(["bookings", "calls", "conversations", "documents", "messages", "opportunities", "tasks"]);
  });

  it("the output has no field that could hold a message, a note or a chat (mutation: add `messages: []` to the result -> FAILS)", async () => {
    const { p } = build();
    expect(Object.keys(await p).sort()).toEqual(["bookings", "calls", "deals", "documents", "facts", "nextBooking", "todos", "who"]);
  });

  it("every read is this account's, the stage read included (second-account case, deal present; review I4; mutation: drop .eq('account_id', accountId) from any one read -> FAILS naming its table)", async () => {
    const { r, p } = build(DEAL);
    await p;
    expect(r.calls.some((c) => c.table === "pipeline_stages")).toBe(true);
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

  it("documents: live files with a ready version only, never Owners-only, as the card lists them (G7; final review I-2; mutations: drop .eq('owners_only', false) -> FAILS; drop .is('deleted_at', null) -> FAILS; drop .not('current_version_id', 'is', null) -> FAILS)", async () => {
    const { r, p } = build();
    await p;
    const doc = r.calls.find((c) => c.table === "documents")!;
    expect(doc.select).toBe("title, category");
    // The exact chain, in order: a file whose upload never finished (no current version) is not on the card
    // (packages/db/src/documents.ts listRecordDocuments), so it is not in the summary either.
    expect(doc.filters).toEqual([
      ["eq", ["account_id", A]],
      ["eq", ["contact_id", C]],
      ["not", ["current_version_id", "is", null]],
      ["is", ["deleted_at", null]],
      ["eq", ["owners_only", false]],
      ["order", ["created_at", { ascending: false }]],
      ["order", ["id", { ascending: false }]],
      ["limit", [INPUT_LIMITS.documents]],
    ]);
  });

  it("open To-dos only, open deals only (mutations: drop .is('completed_at', null) -> FAILS; drop .eq('status', 'open') -> FAILS)", async () => {
    const { r, p } = build();
    await p;
    expect(r.calls.find((c) => c.table === "tasks")!.filters).toContainEqual(["is", ["completed_at", null]]);
    expect(r.calls.find(isDealList)!.filters).toContainEqual(["eq", ["status", "open"]]);
  });

  it("every list is capped and ordered with an id tie-break; calls leave spam out; the next booking is a booked one from now on (review I2, M8; mutations: drop any .limit, the calls limit, excludeSpam, the .gte or the status filter -> FAILS)", async () => {
    const { r, p } = build(DEAL);
    await p;
    const one = (pred: (c: Call) => boolean) => { const found = r.calls.filter(pred); expect(found).toHaveLength(1); return found[0]!; };
    const bookings = one(isBookingList);
    const next = one(isNext);
    const deals = one(isDealList);
    const tasks = one((c) => c.table === "tasks");
    const documents = one((c) => c.table === "documents");
    expect([limitOf(bookings), limitOf(next), limitOf(deals), limitOf(tasks), limitOf(documents)])
      .toEqual([INPUT_LIMITS.bookings, 1, INPUT_LIMITS.deals, INPUT_LIMITS.todos, INPUT_LIMITS.documents]);
    expect(INPUT_LIMITS).toMatchObject({ bookings: 5, deals: 10, todos: 10, documents: 10, calls: 5 });
    for (const c of [bookings, deals, tasks, documents]) expect(c.filters).toContainEqual(["order", ["id", { ascending: false }]]);
    expect(next.filters).toContainEqual(["order", ["id", { ascending: true }]]);
    expect(next.filters).toContainEqual(["order", ["starts_at", { ascending: true }]]);
    expect(next.filters).toContainEqual(["gte", ["starts_at", NOW.toISOString()]]);
    expect(next.filters).toContainEqual(["eq", ["status", "booked"]]);
    // Two calls reads: the facts' last-talked (1) and the summaries (INPUT_LIMITS.calls); both leave spam out.
    const calls = r.calls.filter((c) => c.table === "calls");
    expect(calls.map(limitOf).sort()).toEqual([1, INPUT_LIMITS.calls]);
    for (const c of calls) expect(c.filters).toContainEqual(["neq", ["outcome", "spam"]]);
  });

  // One case per read: each answers an error and the build must reject (plan deviation 11; review I3, M7).
  it.each<[string, (c: Call) => boolean, RegExp]>([
    ["the bookings count", (c) => c.table === "bookings" && c.select === "id", /facts read failed \(bookings: /],
    ["the bookings list", isBookingList, /bookings read failed/],
    ["the next booking", isNext, /bookings read failed/],
    ["the open deals count", (c) => c.table === "opportunities" && c.select === "monetary_value", /facts read failed \(deals: /],
    ["the open deals list", isDealList, /opportunities read failed/],
    ["the stage names", (c) => c.table === "pipeline_stages", /pipeline_stages read failed/],
    ["the To-dos", (c) => c.table === "tasks", /tasks read failed/],
    ["the documents", (c) => c.table === "documents", /documents read failed/],
    ["the call summaries", (c) => c.table === "calls" && limitOf(c) === INPUT_LIMITS.calls, /listContactCalls failed/],
    ["the last-talked call", (c) => c.table === "calls" && limitOf(c) === 1, /facts read failed \(talked: /],
    ["the conversation", (c) => c.table === "conversations", /facts read failed \(talked: /],
    ["the messages", (c) => c.table === "messages", /facts read failed \(talked: /],
  ])("a failed read of %s fails the whole build (mutations: narrow the facts check to lastTalked; documents.data ?? []; next.data ?? [] -> FAILS)", async (_name, fail, message) => {
    await expect(build(DEAL, fail).p).rejects.toThrow(message);
  });

  it("the stand-in's failure is aimed: with nothing failing, the same build resolves", async () => {
    await expect(build(DEAL, () => false).p).resolves.toMatchObject({ deals: [{ name: "Fence", stage: "Quote sent", amount: 1200.5 }] });
  });

  it("a deal carries its stage's name, read only when there is a deal (mutation: drop the stage read and send stage: null -> FAILS)", async () => {
    const { r, p } = build(DEAL);
    const i = await p;
    expect(i.deals).toEqual([{ name: "Fence", stage: "Quote sent", amount: 1200.5 }]);
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

  it("every text is cut: call summaries at 600, deal names and document titles at 120 (review I2; mutations: drop any one cut -> FAILS)", async () => {
    const i = await build({
      opportunities: { data: [{ name: "D".repeat(200), monetary_value: "10", stage_id: "s1" }] },
      pipeline_stages: { data: [{ id: "s1", name: "New" }] },
      documents: { data: [{ title: "F".repeat(200), category: "other" }] },
      calls: { data: [{ id: "k1", contact_id: C, started_at: "2026-10-17T20:00:00Z", outcome: "booked", duration_secs: 60, reason: null, summary: "S".repeat(700), language: "en" }] },
    }).p;
    expect([i.calls[0]!.summary, i.deals[0]!.name, i.documents[0]!.title]).toEqual(["S".repeat(600), "D".repeat(120), "F".repeat(120)]);
  });

  it("redaction runs BEFORE the cut, so a number straddling the cut never leaves as a fragment (review I2; mutation: cut, then redact -> '956' survives -> FAILS)", async () => {
    // Cut first, the title would end " 956-" and the summary " 956-": too few digits for the redactor to see a number.
    const i = await build({
      tasks: { data: [{ title: `${"x".repeat(115)} 956-555-0100`, due_at: null }] },
      calls: { data: [{ id: "k1", contact_id: C, started_at: "2026-10-17T20:00:00Z", outcome: "booked", duration_secs: 60, reason: null, summary: `${"y".repeat(595)} 956-555-0100`, language: "en" }] },
    }).p;
    expect(i.todos[0]!.title).not.toMatch(/\d/);
    expect(i.calls[0]!.summary).not.toMatch(/\d/);
  });

  it("redacts phones and emails in call summaries and keeps dates, times, amounts and short numbers (I6; mutation: drop the digit-count test -> '2026-10-14' is redacted -> FAILS)", () => {
    expect(redactContactDetails("Call me at (956) 555-0100 or +1 956 555 0100, or ana.g@example.com, on 2026-10-14 for $1,200 at 10:30. Ref 12345."))
      .toBe("Call me at [number] or [number], or [email], on 2026-10-14 for $1,200 at 10:30. Ref 12345.");
  });

  it.each([
    ["an en dash between the groups", "Call 956–555–0100 today", "Call [number] today"],
    ["a slash after the area code", "Call 956/555-0100 today", "Call [number] today"],
  ])("redacts a number written with %s (review M6)", (_name, input, out) => {
    expect(redactContactDetails(input)).toBe(out);
  });

  it.each([
    ["an ISO date in brackets", "Seen (2026-10-14) at the house"],
    ["an ISO date with its time", "Booked for 2026-10-14 10:30 at the house"],
    ["a US date", "Visit on 10/14/2026, then again"],
    ["a dotted day-first date", "Visit on 14.10.2026, then again"],
    ["a dashed date", "Visit on 10-14-2026 9:15, then again"],
  ])("keeps %s (review M6)", (_name, input) => {
    expect(redactContactDetails(input)).toBe(input);
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

  it("the last name never leaves where it reads as a name, in any free text: the expiry pass's own To-do titles, deal names, document titles, call summaries and the source (review I1; owner ruling 2026-10-18; mutations: skip the name redactor on To-dos -> FAILS; match the full name case-sensitively -> 'ana garcia lease' FAILS)", async () => {
    const expiry = (name: string, lang: "en" | "es") => expiryTaskTitle({ category: "id", title: "Driver license", name, expiresOn: "2026-11-02" }, lang);
    const r = recordingDb({
      conversations: { data: { id: "v1" } },
      tasks: { data: [{ title: expiry("Ana Garcia", "en"), due_at: null }, { title: expiry("Ana Garcia", "es"), due_at: null }] },
      opportunities: { data: [{ name: "Deck for the Garcia family", monetary_value: "10", stage_id: "s1" }] },
      pipeline_stages: { data: [{ id: "s1", name: "New" }] },
      documents: { data: [{ title: "ana Garcia lease", category: "contract" }] },
      calls: { data: [{ id: "k1", contact_id: C, started_at: "2026-10-17T20:00:00Z", outcome: "booked", duration_secs: 60, reason: null, summary: "Mrs. Garcia wants a quote.", language: "en" }] },
    });
    const i = await buildSummaryInputs(r.db, { accountId: A, contact: { ...CONTACT, source: "referral from the Garcia family" }, zone: ZONE, now: NOW });
    expect(i.todos.map((t) => t.title)).toEqual([expiry("Ana", "en"), expiry("Ana", "es")]);
    expect(i.todos[0]!.title).toBe("Ana's ID expires on Nov 2");
    expect([i.deals[0]!.name, i.documents[0]!.title, i.calls[0]!.summary, i.who.source])
      // The full name, in any case, becomes its first name as written there.
      .toEqual(["Deck for the [name] family", "ana lease", "Mrs. [name] wants a quote.", "referral from the [name] family"]);
    expect(JSON.stringify(i)).not.toMatch(/garcia/i);
  });

  // Owner ruling 2026-10-18, "only where it's a name": a last name that is also a word stays a word.
  it.each<[string, string, string]>([
    ["Price", "Wants a price for the fence. Price is fine.", "no cue, either case"],
    ["Price", "The price's fine and the Price is right", "a possessive on the lowercase word"],
    ["Bill", "Send Bill the bill; the bill's due Friday", "a lowercase possessive"],
    ["Flores", "Plantar flores en el jardín", "a Spanish common noun"],
    ["Flores", "Las flores familia de plantas", "a lowercase word beside 'familia'"],
    ["Flores", "Don't miss Flores Road", "a lowercase miss (round 3, item 3)"],
    ["Mesa", "Put it on the ms Mesa table", "a lowercase ms (round 3, item 3)"],
    ["Flores", "Don't Flores", "an apostrophe inside a word before it"],
    ["Green", "Paint the door green. Green trim too.", "a colour"],
    ["Stone", "A stone wall; the stone's weight", "a lowercase possessive"],
    ["Rosa", "Una rosa para mamá", "a flower"],
    ["Paz", "Que lo deje en paz", "a common noun"],
    ["May", "Come back in May, may be sooner", "a month"],
    ["Will", "I will call, Will said nothing", "a verb"],
    ["Cruz", "Lives on Santa Cruz Ave", "a street"],
    ["de la Garza", "Turn left on Garza Road", "a street"],
    ["Price", "Dr price called about mrs price", "a lowercase word after an honorific"],
    // Round 4, item 1: Title Case text is not a middle name.
    ["Price", "Call Ana About Price Quote", "a title-case run after the first name"],
    ["Price", "Ana Tree price list", "a lowercase last name after a capitalised word"],
    ["Stone", "Ana Front Yard Stone Wall Install", "two capitalised words, then the name, then another"],
    ["Flores", "Ana Fence Flores Road", "a street after the first name"],
    ["Price", "Mr. Smith Lawn Price list", "capitalised words between an honorific and the name"],
    // Round 4, item 3: a short honorific with no period, not in capitals.
    ["Price", "Prof Price list", "Prof with no period"],
    ["Flores", "MX Flores Pro trimmer", "MX with no period before a name not in capitals"],
    ["Garza", "Oak dr Garza Plaza", "dr with no period"],
    ["Flores", "Ing Flores", "Ing with no period"],
    ["Flores", "Lic Flores", "Lic with no period"],
  ])("leaves %s alone in %j (%s)", (last, text) => {
    expect(redactName(text, "Ana", last)).toBe(text);
  });

  it.each<[string, string | null, string, string]>([
    ["an honorific", null, "Flores", "Mrs. Flores called; Sra Flores también; Dr. Flores; Doña Flores"],
    ["a possessive", null, "Flores", "Flores's yard and Flores’s fence"],
    ["the family, either side", null, "Flores", "the Flores family; la familia Flores"],
  ])("redacts a last name where it reads as a name: %s (mutations: drop that cue -> FAILS)", (_cue, first, last, text) => {
    expect(redactName(text, first, last)).not.toMatch(/Flores/);
  });

  // Round 3, item 1: every honorific, Spanish ones included, written accent-folded and longest first.
  it.each([
    "La señora Flores llamó", "El señor Flores vino", "Señorita Flores", "Dra. Flores", "Lic. Flores", "Licda. Flores",
    "Ing. Flores", "los Sres. Flores", "las Sras. Flores", "Mx. Flores", "Prof. Flores", "Srta. Flores", "Sra Flores",
    "Sr. Flores", "Mr. Flores", "Mrs. Flores", "Ms. Flores", "Miss Flores", "Dr. Flores", "Don Flores", "Doña Flores", "Prof. Flores Jr", "Lic.Flores",
  ])("the honorific in %j redacts the name, and only the name (mutation: drop that honorific -> FAILS)", (text) => {
    expect(redactName(text, null, "Flores")).toBe(text.replace("Flores", "[name]"));
  });

  // Round 4, item 2 (orchestrator ruling): the first name in any case, the last name only as stored or in capitals.
  it.each<[string, string, string]>([
    ["Will", "Price", "Will price the job"],
    ["Rosa", "Flores", "comprar rosa flores"],
    ["Ana", "Price", "ana price check"],
  ])("a full name needs its last name as stored or in capitals: %s %s in %j stays (mutation: last name in any case -> FAILS)", (first, last, text) => {
    expect(redactName(text, first, last)).toBe(text);
  });

  it("a short honorific in capitals needs no period before a name in capitals (round 4, item 3; mutation: drop the capitals form -> FAILS)", () => {
    expect(redactName("DR FLORES called; PROF FLORES; MX FLORES", null, "Flores")).toBe("DR [name] called; PROF [name]; MX [name]");
  });

  it("with a cue, the name in full capitals and the honorific in any case still redact (round 3, item 2a; mutations: stored form only -> FAILS; case-sensitive honorific -> FAILS)", () => {
    expect(redactName("MRS. FLORES called", null, "Flores")).toBe("MRS. [name] called");
    expect(redactName("Mrs. FLORES called", null, "Flores")).toBe("Mrs. [name] called");
    expect(redactName("SRA. GARCÍA llamó", null, "García")).toBe("SRA. [name] llamó");
    expect(redactName("mrs. Flores called", null, "Flores")).toBe("mrs. [name] called");
    expect(redactName("FLORES'S yard; THE FLORES FAMILY", null, "Flores")).toBe("[name]'S yard; THE [name] FAMILY");
  });

  it("a bare-apostrophe possessive redacts (round 3, item 2b; mutation: 's only -> FAILS)", () => {
    expect(redactName("the Flores' office and the Flores’ truck", null, "Flores")).toBe("the [name]' office and the [name]’ truck");
  });

  it("middle names: the full name with up to two between, the last name as stored or in capitals and not followed by another capitalised word (round 3, item 2c; round 4; mutation: no middle words in the full name -> FAILS)", () => {
    expect(redactName("Sra. Ana María Flores llamó", "Ana", "Flores")).toBe("Sra. Ana María llamó");
    expect(redactName("Sra. Ana Flores llamó", "Ana María", "Flores")).toBe("Sra. Ana llamó");
    expect(redactName("ana maría Flores llamó", "Ana María", "Flores")).toBe("ana maría llamó");
    expect(redactName("Ana Lucía María Flores llamó", "Ana", "Flores")).toBe("Ana Lucía María llamó");
    // Round 4: words between an honorific and a last name are left to the full-name rule (with the stored first
    // name); "Sra. Lupe María Flores" has the same shape as "Mr. Smith Lawn Price list", so it passes (residual).
    expect(redactName("Sra. Lupe María Flores llamó", null, "Flores")).toBe("Sra. Lupe María Flores llamó");
  });

  it("each cue redacts only the name, never the cue word", () => {
    expect(redactName("Mrs. Flores called", null, "Flores")).toBe("Mrs. [name] called");
    expect(redactName("Flores's yard and Flores’s fence", null, "Flores")).toBe("[name]'s yard and [name]’s fence");
    expect(redactName("the Flores family; la familia Flores", null, "Flores")).toBe("the [name] family; la familia [name]");
    expect(redactName("Sra Flores, Srta. Flores, Don Flores, Doña Flores, Miss Flores", null, "Flores"))
      .toBe("Sra [name], Srta. [name], Don [name], Doña [name], Miss [name]");
  });

  it("accents fold on both sides: stored García matches Garcia and the other way round (mutation: no accent folding -> FAILS)", () => {
    expect(redactName("Ana Garcia's ID; Mrs. Garcia called", "Ana", "García")).toBe("Ana's ID; Mrs. [name] called");
    expect(redactName("La identificación de Ana García; la Sra. García llamó", "Ana", "Garcia")).toBe("La identificación de Ana; la Sra. [name] llamó");
    expect(redactName("José Núñez llamó; la familia Nuñez otra vez", "José", "Núñez")).toBe("José llamó; la familia [name] otra vez");
  });

  it("a straight and a curly apostrophe in a name are one character: stored O'Brien matches O’Brien and the other way round (final review M-c; mutation: escape the apostrophe as itself -> FAILS)", () => {
    expect(redactName("Sean O’Brien called; Mrs. O’Brien later; the O’BRIEN family", "Sean", "O'Brien"))
      .toBe("Sean called; Mrs. [name] later; the [name] family");
    expect(redactName("Sean O'Brien called; Mrs. O'Brien later; O'Brien's fence", "Sean", "O’Brien"))
      .toBe("Sean called; Mrs. [name] later; [name]'s fence");
  });

  it("a compound last name: the whole, its final part, and the first of two parts, each in the cue positions (mutations: drop the final part -> 'Sr. Garza' FAILS; drop the first of two -> 'Sr. García' FAILS)", () => {
    expect(redactName("Ana de la Garza called; Sr. Garza later; the Garza family", "Ana", "de la Garza")).toBe("Ana called; Sr. [name] later; the [name] family");
    expect(redactName("Mrs. de la Garza's yard", null, "de la Garza")).toBe("Mrs. [name]'s yard");
    expect(redactName("Sr. García López; Sr. García; la familia López; López's fence", null, "García López"))
      .toBe("Sr. [name]; Sr. [name]; la familia [name]; [name]'s fence");
    // A particle is never matched on its own, even as the first of two parts (mutation: allow lowercase parts -> FAILS).
    expect(redactName("Mr. de called", null, "de la Garza")).toBe("Mr. de called");
    expect(redactName("Ask Mr. de Haan, then Sr. León", null, "de León")).toBe("Ask Mr. de Haan, then Sr. [name]");
  });

  it("the full name becomes the first name in any case; with no last name nothing changes; a bare capitalised name with no cue passes (accepted residual)", () => {
    expect(redactName("ANA GARCIA called, then ana Garcia again", "Ana", "Garcia")).toBe("ANA called, then ana again");
    expect(redactName("Ana Garcia called", "Ana", "Garcia")).toBe("Ana called");
    expect(redactName("Ana Garcia called", "Ana", null)).toBe("Ana Garcia called");
    expect(redactName("Garcia called", null, "Garcia")).toBe("Garcia called");
    expect(redactName("Garciaville's yard", null, "Garcia")).toBe("Garciaville's yard");
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
