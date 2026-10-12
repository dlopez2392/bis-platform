import { describe, it, expect } from "vitest";
import type { TimelineEntry } from "@bis/db";
import { authorOf, authorMark, personIdsOf, type AuthorCtx } from "./author-mark";
import { makeTr } from "./copy";

const AT = "2026-10-09T16:12:00+00:00";
const FIVE = ["person", "ai", "automation", "customer", "import"];
const task = (over: Record<string, unknown> = {}): TimelineEntry => ({ kind: "task", id: "t1", at: AT, task: {
  id: "t1", title: "x", due_at: null, completed_at: null, created_at: AT, consent_event_id: null, call_id: null,
  assigned_to: null, created_by: null, ...over } }) as unknown as TimelineEntry;
const message = (over: Record<string, unknown>): TimelineEntry => ({ kind: "message", id: "m1", at: AT, message: {
  id: "m1", channel: "sms", direction: "outbound", status: "sent", subject: null, body: "x", error: null, created_at: AT,
  author_kind: null, author_id: null, ...over } }) as unknown as TimelineEntry;
const booking = (author_kind: string | null): TimelineEntry => ({ kind: "booking", id: "b1", at: AT, booking: {
  id: "b1", created_at: AT, starts_at: AT, status: "booked", note: null, author_kind, author_id: null,
  rescheduled_from_id: null, moved_from_starts_at: null } as never });
const ENTRIES: [string, TimelineEntry, string][] = [
  ["note", { kind: "note", id: "n1", at: AT, note: { id: "n1", body: "x", author_id: "user_dan", created_at: AT } }, "person"],
  ["callback To-do", task({ call_id: "c1" }), "ai"],
  ["stop-hold To-do", task({ consent_event_id: "e1" }), "automation"],
  ["typed To-do", task({ created_by: "user_dan" }), "person"],
  ["deal", { kind: "deal", id: "d1", at: AT, deal: { id: "d1", name: "Deck", status: "open", monetary_value: 0, created_at: AT, created_by: null } }, "person"],
  ["web chat", { kind: "submission", id: "s1", at: AT, submission: { id: "s1", created_at: AT, formName: "Q", answers: [], author_kind: "ai" } }, "ai"],
  ["typed form", { kind: "submission", id: "s2", at: AT, submission: { id: "s2", created_at: AT, formName: "Q", answers: [], author_kind: "customer" } }, "customer"],
  ["inbound text, pre-0074", message({ direction: "inbound" }), "customer"],
  ["outbound text, pre-0074", message({}), "person"],
  ["recipe text", message({ author_kind: "automation" }), "automation"],
  ["staff email", message({ author_kind: "person", author_id: "user_dan", channel: "email" }), "person"],
  ["booking page", booking("customer"), "customer"],
  ["receptionist booking", booking("ai"), "ai"],
  ["booking, pre-0074", booking(null), "customer"],
  ["call", { kind: "call", id: "k1", at: AT, call: { id: "k1", started_at: AT, outcome: "booked", duration_secs: 60, reason: null, summary: "", language: "en" } }, "ai"],
];

const ctx = (over: Partial<AuthorCtx> = {}): AuthorCtx =>
  ({ viewerId: "user_me", names: { user_dan: "Dan López" }, personaName: null, tr: makeTr("en"), ...over });

describe("authorOf: every row kind and source gives spec §6's kind (mutation: mark a call 'automation' -> FAILS)", () => {
  it.each(ENTRIES)("%s", (_name, entry, kind) => {
    expect(authorOf(entry).kind).toBe(kind);
    expect(FIVE).toContain(authorMark(entry, ctx()).kind);
  });
});

describe("authorMark's words (spec §6 Names, D9, D10, D11)", () => {
  const note = (author_id: string | null): TimelineEntry => ({ kind: "note", id: "n", at: AT, note: { id: "n", body: "x", author_id, created_at: AT } });
  it("names a readable person, says You only for the viewer, and Someone on the team for anyone else (mutation: You for every person -> FAILS)", () => {
    expect(authorMark(note("user_dan"), ctx()).label).toBe("Dan López");
    expect(authorMark(note("user_me"), ctx()).label).toBe("You");
    expect(authorMark(note("user_gone"), ctx()).label).toBe("Someone on the team");
    expect(authorMark(note(null), ctx()).label).toBe("Someone on the team");
  });
  it("an id that names an Object property is not a name (mutation: read names[id] without hasOwn -> a function leaks in, FAILS)", () => {
    expect(authorMark(note("constructor"), ctx()).label).toBe("Someone on the team");
  });
  it("the receptionist is the account's persona, else Sofía; the rest are words (mutation: hard-code Sofía -> FAILS)", () => {
    const call = ENTRIES.find(([n]) => n === "call")![1];
    expect(authorMark(call, ctx({ personaName: "Lupita" })).label).toBe("Lupita · AI");
    expect(authorMark(call, ctx()).label).toBe("Sofía · AI");
    expect(authorMark(booking("customer"), ctx()).label).toBe("Customer");
    expect(authorMark(message({ author_kind: "automation" }), ctx()).label).toBe("Automation");
  });
  it("in Spanish (mutation: build labels from m[...] -> English, FAILS)", () => {
    const es = ctx({ tr: makeTr("es") });
    expect(authorMark(booking("customer"), es).label).toBe("Cliente");
    expect(authorMark(note("user_me"), es).label).toBe("Usted");
    expect(authorMark(note(null), es).label).toBe("Alguien del equipo");
    expect(authorMark(ENTRIES.find(([n]) => n === "call")![1], es).label).toBe("Sofía · IA");
  });
});

describe("personIdsOf: the ids one names read asks for (spec §6)", () => {
  it("only person marks, each once (mutation: include a callback To-do's created_by -> FAILS)", () => {
    const entries = [...ENTRIES.map(([, e]) => e), task({ call_id: "c9", created_by: "user_ai_shadow" })];
    expect(personIdsOf(entries).sort()).toEqual(["user_dan"]);
  });
});

describe("authorMark names the staff member behind a message or a booking (review I1)", () => {
  // user_ana appears on no other row, so personIdsOf's dedupe cannot hide a dropped id.
  const named = ctx({ names: { user_dan: "Dan López", user_ana: "Ana Ruiz" } });
  it("a staff email carries its writer's name (mutation: a message's person is always unnamed -> FAILS)", () => {
    expect(authorMark(message({ author_kind: "person", author_id: "user_ana", channel: "email" }), named))
      .toEqual({ kind: "person", label: "Ana Ruiz" });
    expect(personIdsOf([message({ author_kind: "person", author_id: "user_ana" })])).toEqual(["user_ana"]);
  });
  it("a booking a person made carries their name (mutation: a booking's person is always unnamed -> FAILS)", () => {
    const b = booking("person");
    (b as { booking: { author_id: string | null } }).booking.author_id = "user_ana";
    expect(authorMark(b, named)).toEqual({ kind: "person", label: "Ana Ruiz" });
    expect(personIdsOf([b])).toEqual(["user_ana"]);
  });
});

describe("an author_kind outside the five is the person mark, unnamed: never a sixth kind, never blank (review minor 3)", () => {
  it.each([
    ["message", message({ author_kind: "robot", author_id: "user_dan" })],
    ["booking", booking("robot")],
    ["submission", { kind: "submission", id: "s9", at: AT, submission: { id: "s9", created_at: AT, formName: "Q", answers: [], author_kind: "robot" } } as unknown as TimelineEntry],
  ])("%s (mutation: pass the column through unchecked -> FAILS)", (_n, entry) => {
    expect(authorOf(entry)).toEqual({ kind: "person", personId: null });
    expect(authorMark(entry, ctx())).toEqual({ kind: "person", label: "Someone on the team" });
  });
});
