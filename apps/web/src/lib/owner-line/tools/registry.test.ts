import { describe, it, expect, vi, beforeEach } from "vitest";

const r = vi.hoisted(() => ({ calls: vi.fn(), reasons: vi.fn(), agenda: vi.fn(), work: vi.fn(), answered: vi.fn(), spam: vi.fn(), names: vi.fn() }));
// The real module under the four readers: callbackTaskTitle's own module (call-card) reads @bis/db's constants.
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCalls: r.calls, listCallReasons: r.reasons, listAgendaBookings: r.agenda, listAccountWork: r.work,
  ANSWERED_CALL_OUTCOMES: ["booked", "lead", "message", "transferred"],
}));
vi.mock("@/lib/reports/weekly-metrics", () => ({ listAnsweredCallStartsBetween: r.answered, listSpamCallStartsBetween: r.spam }));
vi.mock("@/lib/voice/caller-reputation", () => ({ agencyHandsets: () => ["+19565550999"] }));
import { runOwnerTool, type OwnerToolContext } from "./registry";
import { OWNER_TOOL_NAMES } from "./schemas";
import { toolSchemas } from "@/lib/voice/tools/schemas";
import { callbackTaskTitle } from "@/lib/voice/call-card";
import { m } from "@/lib/messages";

const A = "acct-A";
// The factory's client: a fake that answers the one direct read this module makes (contact names for To do rows).
const DB = { from: (table: string) => ({ select: () => ({ eq: () => ({ in: async (_c: string, ids: string[]) => {
  r.names(table, ids);
  return { data: [{ id: "k1", first_name: "Maria", last_name: "López" }].filter((k) => ids.includes(k.id)), error: null };
} }) }) }) } as never;
const SESSION = { accountId: A, userId: "u1", role: "staff" as const, clerkUserId: "c1", clerkOrgId: "o1",
  firstName: "Dan", actorName: "Dan Lopez", locale: "en" as const, timezone: "America/Chicago" };
const NOW = new Date("2026-11-09T21:00:00.000Z");   // 3:00 PM CST
const ctx = (over: Partial<OwnerToolContext> = {}): OwnerToolContext => ({
  session: SESSION, now: () => NOW, recheck: vi.fn(async () => true), client: vi.fn(() => DB), ...over });
// Sofía's own callback To do, written by the REAL writer (finish-call.ts:604), with the number as the caller's ID
// gave it. The owner line reads it as written (owner ruling 2026-11-09, extended: review I-3).
const CALLBACK_NUMBER = "+19565550177";
const CALLBACK_TITLE = callbackTaskTitle(CALLBACK_NUMBER, "Roof leak");
const call = (id: string, startedAt: string, over = {}) => ({ id, started_at: startedAt, ended_at: null, duration_secs: 60,
  outcome: "lead", language: "en", caller_e164: "+19565550177", contact_id: "k1", conversation_id: null,
  owner_line_user_id: null, contact: { first_name: "Maria", last_name: "López" }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  r.calls.mockResolvedValue([
    call("c4", "2026-11-09T20:30:00.000Z", { outcome: "spam", contact: null }),                    // flagged spam: counted apart
    call("c3", "2026-11-09T20:14:00.000Z"),                                                        // lead
    call("c2", "2026-11-09T19:00:00.000Z", { contact: null, outcome: "message" }),                 // a new caller
    call("c5", "2026-11-09T18:30:00.000Z", { caller_e164: "+19565550999", outcome: "booked" }),    // the agency's handset
    call("c1", "2026-11-09T18:00:00.000Z", { owner_line_user_id: "u1", outcome: "message" }),      // an owner-line call
    call("c0", "2026-11-08T12:00:00.000Z"),                                                        // yesterday
  ]);
  // The tile counts THREE today (one it counts is not among the rows listCalls returns here), so a count taken from
  // the described rows (2) can be told apart from the tile's (3).
  r.answered.mockResolvedValue(["2026-11-09T20:14:00.000Z", "2026-11-09T19:00:00.000Z", "2026-11-09T17:00:00.000Z"]);
  r.spam.mockResolvedValue(["2026-11-09T20:30:00.000Z"]);
  r.reasons.mockResolvedValue(new Map([["c3", "Roof leak over the kitchen"]]));
  r.work.mockResolvedValue([
    { id: "task:t1", source: "task", accountId: A, contactId: "k1", title: CALLBACK_TITLE, dueAt: null, occurredAt: "x", callId: "c3" },
    { id: "conversation:v1", source: "conversation", accountId: A, contactId: "k1", title: "", dueAt: null, occurredAt: "x" },
    { id: "booking:b1", source: "booking", accountId: A, contactId: "k1", title: "", dueAt: null, occurredAt: "x" },
  ]);
  r.agenda.mockResolvedValue({ truncated: false, rows: [
    { id: "b1", starts_at: "2026-11-10T15:00:00.000Z", status: "booked", meeting_type: "in_person", note: "gate code 1234", replaced: false,
      contact: { first_name: "Ana", last_name: null, phone: "+19565550188", email: "ana@example.com" }, place: { label: "Home", address: "1 Main" } },
    { id: "b0", starts_at: "2026-11-10T14:00:00.000Z", status: "cancelled", meeting_type: null, note: null, replaced: true, contact: null, place: null },
  ] });
});

describe("the owner tools (F-032 §5)", () => {
  it("THE WALL: only the three owner tools exist, and no receptionist tool is among them", () => {
    expect([...OWNER_TOOL_NAMES].sort()).toEqual(["appointments", "calls_and_messages", "needs_attention"]);
    const receptionist = toolSchemas("full", "in_person", true).map((t: { name: string }) => t.name);
    expect(OWNER_TOOL_NAMES.filter((n) => (receptionist as string[]).includes(n))).toEqual([]);
  });

  it("a session that is no longer valid gets an error and NO read at all (mutation: skip the recheck -> FAILS)", async () => {
    const c = ctx({ recheck: vi.fn(async () => false) });
    expect(await runOwnerTool(c, "calls_and_messages", { range: "today" })).toEqual({ ok: false, error: "couldnt_read" });
    expect(c.client).not.toHaveBeenCalled();
    expect(r.calls).not.toHaveBeenCalled();
  });

  it("a re-check that THROWS fails closed: couldnt_read, and the client and every reader are never called (review I-2; mutation: let live = true -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const tool of OWNER_TOOL_NAMES) {
      const c = ctx({ recheck: vi.fn(async () => { throw new Error("the database is down"); }) });
      expect(await runOwnerTool(c, tool, { range: "today" }), tool).toEqual({ ok: false, error: "couldnt_read" });
      expect(c.recheck, tool).toHaveBeenCalledTimes(1);
      expect(c.client, tool).not.toHaveBeenCalled();
    }
    for (const reader of Object.values(r)) expect(reader).not.toHaveBeenCalled();
  });

  it("a failure is logged as its error CLASS and the account, never its message, which can quote a customer (Task 12 review; mutation: log e.message -> FAILS)", async () => {
    const said = "Maria López called from +19565550177";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // A re-check that throws, then a read that throws: the two places this module logs.
    await runOwnerTool(ctx({ recheck: vi.fn(async () => { throw new TypeError(said); }) }), "appointments", { range: "today" });
    r.agenda.mockRejectedValue(new RangeError(said));
    await runOwnerTool(ctx(), "appointments", { range: "today" });
    const lines = log.mock.calls.map((args) => args.map(String).join(" "));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("TypeError");
    expect(lines[1]).toContain("RangeError");
    for (const line of lines) {
      expect(line).toContain(A);
      expect(line).not.toMatch(/Maria|López|9565550177|called from/);
    }
  });

  it("reads through the factory's client and this session's account only, including the tile's own reads (mutation: serviceDb() in the tool -> FAILS)", async () => {
    await runOwnerTool(ctx(), "calls_and_messages", { range: "today" });
    expect(r.calls).toHaveBeenCalledWith(DB, A, expect.objectContaining({ before: "2026-11-10T06:00:00.000Z" }));
    expect(r.answered).toHaveBeenCalledWith(DB, A, "2026-11-09T06:00:00.000Z", "2026-11-10T06:00:00.000Z");
    expect(r.spam).toHaveBeenCalledWith(DB, A, "2026-11-09T06:00:00.000Z", "2026-11-10T06:00:00.000Z");
  });

  it("Q-E: the count is the 'Calls answered' tile's; spam is said apart; each described call has its outcome in words; owner-line, handset and spam calls are not described (mutation: count the described rows instead of the tile's read -> 2, FAILS)", async () => {
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" });
    expect(out).toEqual({ ok: true, range: { first: "2026-11-09", last: "2026-11-09" }, count: 3, spam: 1, more: 1, calls: [
      { when: "2:14 PM", caller: "Maria López", outcome: "left their details", reason: "Roof leak over the kitchen", needsCallback: true },
      { when: "1:00 PM", caller: "a new caller", outcome: "left a message", reason: null, needsCallback: false },
    ] });
  });

  it("the reasons are read for the spoken calls only, never more than 20 ids (mutation: pass every id -> FAILS)", async () => {
    r.calls.mockResolvedValue(Array.from({ length: 30 }, (_, i) => call(`x${i}`, new Date(Date.parse("2026-11-09T20:00:00.000Z") - i * 60_000).toISOString())));
    r.answered.mockResolvedValue(Array.from({ length: 30 }, () => "t"));
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }) as { more: number };
    expect((r.reasons.mock.calls[0]![2] as string[]).length).toBe(20);
    expect(out.more).toBe(10);
  });

  it("appointments: never the note, the phone, the email or the address; a moved booking's cancelled half is not read out", async () => {
    const out = await runOwnerTool(ctx(), "appointments", { range: "tomorrow" }) as { appointments: object[]; count: number };
    expect(out.count).toBe(1);
    expect(out.appointments).toEqual([{ when: "9:00 AM", customer: "Ana", meetingType: m["calendar.job.inPerson"], status: m["calendar.bookings.status.booked"] }]);
    expect(JSON.stringify(out)).not.toMatch(/gate code|ana@example|5550188|Main/);
  });

  it("appointments: how they meet and the status are WORDS in the person's language, the agenda's own (review m-5; mutation: meetingType: x.meeting_type -> FAILS)", async () => {
    r.agenda.mockResolvedValue({ truncated: false, rows: [
      { id: "b2", starts_at: "2026-11-10T15:00:00.000Z", status: "no_show", meeting_type: "phone", note: null, replaced: false, contact: null, place: null },
      { id: "b3", starts_at: "2026-11-10T16:00:00.000Z", status: "completed", meeting_type: null, note: null, replaced: false, contact: null, place: null },
    ] });
    const out = await runOwnerTool(ctx({ session: { ...SESSION, locale: "es" } }), "appointments", { range: "tomorrow" }) as { appointments: object[] };
    expect(out.appointments).toEqual([
      { when: expect.any(String), customer: null, meetingType: m["calendar.job.byPhone.es"], status: m["calendar.bookings.status.no_show.es"] },
      { when: expect.any(String), customer: null, meetingType: null, status: m["calendar.bookings.status.completed.es"] },
    ]);
    // Never a code: no stored value survives into what is spoken.
    expect(JSON.stringify(out)).not.toMatch(/no_show|in_person|"phone"|"completed"/);
  });

  it("needs_attention: the To do page's own words for each source, with the customer's name, never a raw source code (mutation: what = w.title -> two empty items, FAILS)", async () => {
    expect(await runOwnerTool(ctx(), "needs_attention", {})).toEqual({ ok: true, count: 3, more: 0, items: [
      { what: CALLBACK_TITLE, customer: "Maria López", due: null },
      { what: "Reply to Maria López", customer: "Maria López", due: null },
      { what: "Did this job happen?", customer: "Maria López", due: null },
    ] });
    expect(r.work).toHaveBeenCalledWith(DB, A);
    expect(r.names).toHaveBeenCalledWith("contacts", ["k1"]);
    // The ruling, pinned: the callback number is read as the To do row shows it, digits and all.
    expect(CALLBACK_TITLE).toContain(CALLBACK_NUMBER);
  });

  // One case per To do source (coordinator, Task 11): each source alone, so a wrong sentence for ONE source fails by
  // name. #343 adds failed_transfer and booking_act: add their cases here when it merges (plan Task 11 note).
  it.each([
    // A number the caller SAID (not their caller ID) is stored national, as spokenPhone returns it; no reason given.
    ["task", { id: "task:t1", source: "task", title: callbackTaskTitle("9565550123", null) }, callbackTaskTitle("9565550123", null)],
    ["conversation", { id: "conversation:v1", source: "conversation", title: "Roof leak (the call's summary)" }, "Reply to Maria López"],
    ["booking", { id: "booking:b1", source: "booking", title: "" }, "Did this job happen?"],
  ] as const)("needs_attention, %s: the To do page's words for that source (mutation: what = w.title -> FAILS for the derived sources)", async (_s, row, words) => {
    r.work.mockResolvedValue([{ accountId: A, contactId: "k1", dueAt: null, occurredAt: "x", ...row }]);
    expect(await runOwnerTool(ctx(), "needs_attention", {})).toEqual({ ok: true, count: 1, more: 0, items: [
      { what: words, customer: "Maria López", due: null },
    ] });
  });

  // Review m-2: the listing stops as soon as it holds the 20 calls it will describe. "truncated" is GONE from this
  // tool: the count is the tile's, which reads every row (listCallStartsByOutcomeBetween pages to the end), so the
  // count itself is never capped, and a flag saying the LIST stopped early told the model nothing it could say.
  const fullPages = (outcomeOf: (page: number, i: number) => string = () => "lead") => {
    let page = 0;
    r.calls.mockImplementation(async () => {
      const base = Date.parse("2026-11-09T20:59:00.000Z") - page * 100 * 1_000;
      const p = page;
      page += 1;
      return Array.from({ length: 100 }, (_, i) => call(`p${p}_${i}`, new Date(base - i * 1_000).toISOString(), { outcome: outcomeOf(p, i) }));
    });
  };
  it("at exactly 1000 answered calls: ONE page read (20 collected), the count is the tile's 1000, and nothing claims the list was cut (mutation: drop the stop at 20 -> 10 reads, FAILS)", async () => {
    fullPages();
    r.answered.mockResolvedValue(Array.from({ length: 1000 }, () => "t"));
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }) as { count: number; more: number; calls: unknown[] };
    expect(r.calls).toHaveBeenCalledTimes(1);
    expect([out.count, out.more, out.calls.length]).toEqual([1000, 980, 20]);
    expect(out).not.toHaveProperty("truncated");
  });
  it("a page holding fewer than 20 of the tile's calls reads on until it has 20, then stops (mutation: stop after the first page -> 5 described, FAILS)", async () => {
    // Page 0: five leads among 95 spam. Page 1 and on: all leads.
    fullPages((p, i) => (p === 0 && i % 20 !== 0 ? "spam" : "lead"));
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }) as { calls: unknown[] };
    expect(r.calls).toHaveBeenCalledTimes(2);
    expect(out.calls).toHaveLength(20);
  });
  it("the listing is still bounded at 10 pages when no page holds a call the tile counts (mutation: CALL_PAGES 11 -> FAILS)", async () => {
    fullPages(() => "spam");
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }) as { calls: unknown[] };
    expect(r.calls).toHaveBeenCalledTimes(10);
    expect(out.calls).toEqual([]);
  });

  // Review m-6: PostgREST writes timestamptz as "2026-11-09T06:00:00+00:00", and the range's edge is
  // "2026-11-09T06:00:00.000Z". As strings the first sorts BEFORE the second ("+" < "."), so a string compare dropped
  // a call that started on the range's first instant. Instants are compared.
  it("a call that starts on the range's very first instant, written +00:00 as PostgREST writes it, is described (mutation: compare the strings -> FAILS)", async () => {
    r.calls.mockResolvedValue([
      call("e1", "2026-11-09T06:00:00+00:00"),
      call("e0", "2026-11-09T05:59:59+00:00"),   // one second before: yesterday in Chicago
    ]);
    r.answered.mockResolvedValue(["2026-11-09T06:00:00+00:00"]);
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }) as { calls: { when: string }[] };
    expect(out.calls.map((x) => x.when)).toEqual(["12:00 AM"]);
  });
  it("a full page whose last row starts on the range's first instant is the last page read: the next page can only be earlier (mutation: < instead of <= -> a second read, FAILS)", async () => {
    r.calls.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) =>
      i === 99 ? call("edge", "2026-11-09T06:00:00+00:00") : call(`s${i}`, new Date(Date.parse("2026-11-09T20:00:00.000Z") - i * 1_000).toISOString(), { outcome: "spam" })));
    r.calls.mockResolvedValue([call("old", "2026-11-09T05:00:00+00:00")]);
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }) as { calls: unknown[] };
    expect(r.calls).toHaveBeenCalledTimes(1);
    expect(out.calls).toHaveLength(1);
  });

  it("no tool says an id, a phone number, a note or anything secret, except the ONE sanctioned number: Sofía's callback To do, read as written (owner ruling 2026-11-09; mutations: add id, or the caller's number, to a spoken call -> FAILS)", async () => {
    const calls = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" });
    const appts = await runOwnerTool(ctx(), "appointments", { range: "tomorrow" });
    const todo = await runOwnerTool(ctx(), "needs_attention", {}) as { items: { what: string }[] };
    // The exception is exactly the callback To do's own words, in needs_attention's "what", and nowhere else: the
    // same number is the fixture calls' caller ID, so it showing up in calls_and_messages fails below.
    expect(todo.items[0]!.what).toBe(CALLBACK_TITLE);
    const scrubbed = { ...todo, items: todo.items.map((x) => (x.what === CALLBACK_TITLE ? { ...x, what: "<the callback To do>" } : x)) };
    const text = JSON.stringify([calls, appts, scrubbed]);
    // Every id in the fixtures, every digit string of a phone, the note, the email and the address.
    for (const banned of ["c0", "c1", "c2", "c3", "c4", "c5", "k1", "t1", "v1", "b0", "b1", "acct-A", "u1",
      "9565550", "+1956", "gate code", "ana@example", "Main", "Home"]) {
      expect(text, banned).not.toContain(banned);
    }
    // And no other digit run long enough to be a number someone could dial or an id (dates are 4, times 1-2).
    expect(text).not.toMatch(/[0-9]{5,}/);
    expect(text).not.toMatch(/\+[0-9]/);
  });

  it("a range of 32 days is refused before any read", async () => {
    expect(await runOwnerTool(ctx(), "appointments", { range: "dates", from: "2026-10-01", to: "2026-11-01" }))
      .toEqual({ ok: false, error: "range_too_long" });
    expect(r.agenda).not.toHaveBeenCalled();
  });

  it("a reader that throws is 'couldnt_read', never a partial answer", async () => {
    r.agenda.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runOwnerTool(ctx(), "appointments", { range: "today" })).toEqual({ ok: false, error: "couldnt_read" });
  });

  it("an unknown tool name, or a receptionist tool name, is refused without a read", async () => {
    expect(await runOwnerTool(ctx(), "book_appointment", {})).toEqual({ ok: false, error: "unknown_tool" });
    expect(r.calls).not.toHaveBeenCalled();
  });
});
