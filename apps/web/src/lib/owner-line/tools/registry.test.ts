import { describe, it, expect, vi, beforeEach } from "vitest";

const r = vi.hoisted(() => ({ calls: vi.fn(), reasons: vi.fn(), agenda: vi.fn(), work: vi.fn(), answered: vi.fn(), spam: vi.fn(), names: vi.fn() }));
vi.mock("@bis/db", () => ({
  listCalls: r.calls, listCallReasons: r.reasons, listAgendaBookings: r.agenda, listAccountWork: r.work,
  ANSWERED_CALL_OUTCOMES: ["booked", "lead", "message", "transferred"],
}));
vi.mock("@/lib/reports/weekly-metrics", () => ({ listAnsweredCallStartsBetween: r.answered, listSpamCallStartsBetween: r.spam }));
vi.mock("@/lib/voice/caller-reputation", () => ({ agencyHandsets: () => ["+19565550999"] }));
import { runOwnerTool, type OwnerToolContext } from "./registry";
import { OWNER_TOOL_NAMES } from "./schemas";
import { toolSchemas } from "@/lib/voice/tools/schemas";

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
    { id: "task:t1", source: "task", accountId: A, contactId: "k1", title: "Call back Maria", dueAt: null, occurredAt: "x", callId: "c3" },
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

  it("reads through the factory's client and this session's account only, including the tile's own reads (mutation: serviceDb() in the tool -> FAILS)", async () => {
    await runOwnerTool(ctx(), "calls_and_messages", { range: "today" });
    expect(r.calls).toHaveBeenCalledWith(DB, A, expect.objectContaining({ before: "2026-11-10T06:00:00.000Z" }));
    expect(r.answered).toHaveBeenCalledWith(DB, A, "2026-11-09T06:00:00.000Z", "2026-11-10T06:00:00.000Z");
    expect(r.spam).toHaveBeenCalledWith(DB, A, "2026-11-09T06:00:00.000Z", "2026-11-10T06:00:00.000Z");
  });

  it("Q-E: the count is the 'Calls answered' tile's; spam is said apart; each described call has its outcome in words; owner-line, handset and spam calls are not described (mutation: count the described rows instead of the tile's read -> 2, FAILS)", async () => {
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" });
    expect(out).toEqual({ ok: true, range: { first: "2026-11-09", last: "2026-11-09" }, count: 3, spam: 1, more: 1, truncated: false, calls: [
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
    expect(out.appointments).toEqual([{ when: "9:00 AM", customer: "Ana", meetingType: "in_person", status: "booked" }]);
    expect(JSON.stringify(out)).not.toMatch(/gate code|ana@example|5550188|Main/);
  });

  it("needs_attention: the To do page's own words for each source, with the customer's name, never a raw source code (mutation: what = w.title -> two empty items, FAILS)", async () => {
    expect(await runOwnerTool(ctx(), "needs_attention", {})).toEqual({ ok: true, count: 3, more: 0, items: [
      { what: "Call back Maria", customer: "Maria López", due: null },
      { what: "Reply to Maria López", customer: "Maria López", due: null },
      { what: "Did this job happen?", customer: "Maria López", due: null },
    ] });
    expect(r.work).toHaveBeenCalledWith(DB, A);
    expect(r.names).toHaveBeenCalledWith("contacts", ["k1"]);
  });

  // One case per To do source (coordinator, Task 11): each source alone, so a wrong sentence for ONE source fails by
  // name. #343 adds failed_transfer and booking_act: add their cases here when it merges (plan Task 11 note).
  it.each([
    ["task", { id: "task:t1", source: "task", title: "Call back Maria" }, "Call back Maria"],
    ["conversation", { id: "conversation:v1", source: "conversation", title: "Roof leak (the call's summary)" }, "Reply to Maria López"],
    ["booking", { id: "booking:b1", source: "booking", title: "" }, "Did this job happen?"],
  ] as const)("needs_attention, %s: the To do page's words for that source (mutation: what = w.title -> FAILS for the derived sources)", async (_s, row, words) => {
    r.work.mockResolvedValue([{ accountId: A, contactId: "k1", dueAt: null, occurredAt: "x", ...row }]);
    expect(await runOwnerTool(ctx(), "needs_attention", {})).toEqual({ ok: true, count: 1, more: 0, items: [
      { what: words, customer: "Maria López", due: null },
    ] });
  });

  it("calls_and_messages says truncated when the listing stopped at its page cap, and the count is still the tile's (mutation: never set truncated -> FAILS)", async () => {
    // Every page full of calls the tile counts, all inside today: the listing reads its 10 pages and stops.
    let page = 0;
    r.calls.mockImplementation(async () => {
      const base = Date.parse("2026-11-09T20:59:00.000Z") - page * 100 * 1_000;
      page += 1;
      return Array.from({ length: 100 }, (_, i) => call(`p${page}_${i}`, new Date(base - i * 1_000).toISOString()));
    });
    r.answered.mockResolvedValue(Array.from({ length: 1234 }, () => "t"));
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }) as { truncated: boolean; count: number; more: number };
    expect(r.calls).toHaveBeenCalledTimes(10);
    expect([out.truncated, out.count, out.more]).toEqual([true, 1234, 1234 - 20]);
  });

  it("no tool says an id, a phone number, a note or anything secret: every output is scanned (mutation: add id to a spoken call -> FAILS)", async () => {
    const outs = [
      await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }),
      await runOwnerTool(ctx(), "appointments", { range: "tomorrow" }),
      await runOwnerTool(ctx(), "needs_attention", {}),
    ];
    const text = JSON.stringify(outs);
    // Every id in the fixtures, every digit string of a phone, the note, the email and the address.
    for (const banned of ["c0", "c1", "c2", "c3", "c4", "c5", "k1", "t1", "v1", "b0", "b1", "acct-A", "u1",
      "9565550", "+1956", "gate code", "ana@example", "Main", "Home"]) {
      expect(text, banned).not.toContain(banned);
    }
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
