import { describe, it, expect } from "vitest";
import type { TimelineEntry } from "@bis/db";
import { timelineRows, timelineFailedText } from "./timeline-rows";
import { makeTr } from "./copy";

const author = (locale: "en" | "es" = "en") => ({ viewerId: null, names: {}, personaName: null, tr: makeTr(locale) });
const rows = (entries: TimelineEntry[], locale: "en" | "es" = "en", zone = "America/Chicago") =>
  timelineRows(entries, { zone, tr: makeTr(locale), author: author(locale) });
const call = (secs: number | null, outcome = "booked"): TimelineEntry => ({ kind: "call", id: "k1", at: "2026-10-09T16:12:00Z", contactId: "c1",
  call: { id: "k1", contact_id: "c1", started_at: "2026-10-09T16:12:00Z", outcome, duration_secs: secs, reason: null, summary: "", language: "es" } });
const booking = (status: string, moved: string | null = null): TimelineEntry => ({ kind: "booking", id: "b1", at: "2026-10-09T16:12:00Z", contactId: "c1",
  booking: { id: "b1", contact_id: "c1", created_at: "2026-10-09T16:12:00Z", starts_at: "2026-10-16T15:00:00Z", status, note: null,
    author_kind: "customer", author_id: null, rescheduled_from_id: moved ? "b0" : null, moved_from_starts_at: moved } as never });
const sms = (direction: "inbound" | "outbound", status: string): TimelineEntry => ({ kind: "message", id: "m1", at: "2026-10-09T16:12:00Z", contactId: "c1",
  message: { id: "m1", channel: "sms", direction, status, subject: null, body: "x", error: null, created_at: "2026-10-09T16:12:00Z",
    author_kind: direction === "inbound" ? "customer" : "person", author_id: null } });

describe("timelineRows: each kind's words (spec §6, §10.2)", () => {
  it("a booking reads booked an appointment for its start, in the account's zone, with a dot-and-word status (mutation: format the start in UTC -> 3:00 PM, FAILS)", () => {
    const [r] = rows([booking("booked")]);
    expect(r!.verb).toBe("booked an appointment for Fri, Oct 16, 10:00 AM");
    expect(r!.status).toEqual({ tone: "accent", word: "Booked" });
    expect(r!.mark.label).toBe("Customer");
  });
  it("a reschedule says where it moved from (mutation: drop the detail -> FAILS)", () => {
    expect(rows([booking("booked", "2026-10-14T14:00:00Z")])[0]!.detail).toBe("Moved from Wed, Oct 14, 9:00 AM");
  });
  it("a call: answered, its outcome as a dot and a word, and whole minutes (mutation: Math.floor -> 2 min, FAILS)", () => {
    const [r] = rows([call(150)]);
    expect([r!.verb, r!.status, r!.detail, r!.mark.label]).toEqual(["answered a call", { tone: "good", word: "Booked" }, "3 min", "Sofía · AI"]);
    expect(rows([call(null)])[0]!.detail).toBeNull();
  });
  it("an outbound text shows its delivery state; an inbound one shows none (mutation: status on inbound -> FAILS)", () => {
    expect(rows([sms("outbound", "failed")])[0]!.status).toEqual({ tone: "crit", word: "Failed" });
    expect(rows([sms("inbound", "delivered")])[0]!.status).toBeNull();
    expect(rows([sms("outbound", "brand_new")])[0]!.status).toEqual({ tone: "muted", word: "brand_new" });
  });
  it("in Spanish (mutation: read the words from m[...] -> English, FAILS)", () => {
    const [b] = rows([booking("booked")], "es");
    expect(b!.verb.startsWith("agendó una cita para ")).toBe(true);
    expect(b!.status!.word).toBe("Agendada");
    expect(rows([call(60, "abandoned")], "es")[0]!.status!.word).toBe("Colgó");
    expect(rows([sms("outbound", "delivered")], "es")[0]!.verb).toBe("mandó un texto");
  });
  it("a day separator falls on the ACCOUNT's calendar day (mutation: compute the day in UTC -> one separator, FAILS)", () => {
    const at = (iso: string): TimelineEntry => ({ kind: "note", id: iso, at: iso, contactId: "c1", note: { id: iso, body: "x", author_id: null, created_at: iso } });
    // 05:30Z is Oct 9, 00:30 in Chicago; 03:00Z is still Oct 8 there. One UTC day, two Chicago days.
    expect(rows([at("2026-10-09T05:30:00Z"), at("2026-10-09T03:00:00Z")]).map((r) => r.showDay)).toEqual([true, true]);
    expect(rows([at("2026-10-09T05:30:00Z"), at("2026-10-09T03:00:00Z")], "en", "UTC").map((r) => r.showDay)).toEqual([true, false]);
  });
});

describe("timelineFailedText (spec §9.4: some sources failed)", () => {
  it("names what could not be read, in the page's language (mutation: name only the first -> FAILS)", () => {
    expect(timelineFailedText(["calls", "bookings"], makeTr("en"))).toBe("Couldn't load calls and bookings.");
    expect(timelineFailedText(["calls", "bookings"], makeTr("es"))).toBe("No se pudo cargar: llamadas y citas.");
    expect(timelineFailedText([], makeTr("en"))).toBeNull();
  });
});

describe("timelineRows: every other kind's verb, status and detail (review I1)", () => {
  const AT = "2026-10-09T16:12:00Z";
  const parts = (e: TimelineEntry) => { const [r] = rows([e]); return { verb: r!.verb, status: r!.status, detail: r!.detail }; };
  const submission = (author_kind: string): TimelineEntry => ({ kind: "submission", id: "s1", at: AT, contactId: "c1",
    submission: { id: "s1", created_at: AT, formName: "Quote", answers: [], author_kind } as never });
  const task = (call_id: string | null): TimelineEntry => ({ kind: "task", id: "t1", at: AT, contactId: "c1", task: { id: "t1", title: "x", due_at: null,
    completed_at: null, created_at: AT, consent_event_id: null, call_id, assigned_to: null, created_by: null } });
  const deal = (monetary_value: unknown, status = "won"): TimelineEntry => ({ kind: "deal", id: "d1", at: AT, contactId: "c1",
    deal: { id: "d1", name: "Deck", status, monetary_value, created_at: AT, created_by: null } as never });
  it("the website chat is a request the receptionist took; a typed form is the form the customer sent (mutation: chat reads as a form -> FAILS)", () => {
    expect(parts(submission("ai"))).toEqual({ verb: "took a request in the website chat", status: null, detail: null });
    expect(parts(submission("customer"))).toEqual({ verb: "sent the Quote form", status: null, detail: null });
  });
  it("a callback To-do says so; a typed one does not (mutation: callback reads 'added a To-do' -> FAILS)", () => {
    expect(parts(task("c1"))).toEqual({ verb: "left a callback To-do", status: null, detail: null });
    expect(parts(task(null))).toEqual({ verb: "added a To-do", status: null, detail: null });
  });
  it("a deal names itself, its status as a dot and a word, and its amount (mutation: drop the amount or the status -> FAILS)", () => {
    expect(parts(deal(1500))).toEqual({ verb: "added a deal: Deck", status: { tone: "good", word: "Won" }, detail: "$1,500" });
    expect(parts(deal("2500.00", "open"))).toEqual({ verb: "added a deal: Deck", status: { tone: "accent", word: "Open" }, detail: "$2,500" });
  });
  it("a deal with no amount omits it, never '$0' (DESIGN.md: omitted, never zeroed; mutation: format 0 -> FAILS)", () => {
    for (const v of [0, "0", null]) expect(parts(deal(v)).detail, String(v)).toBeNull();
  });
  it("an email reads emailed, with its delivery state (mutation: every message reads texted -> FAILS)", () => {
    const email: TimelineEntry = { kind: "message", id: "m2", at: AT, contactId: "c1", message: { id: "m2", channel: "email", direction: "outbound",
      status: "delivered", subject: "Hi", body: "x", error: null, created_at: AT, author_kind: "person", author_id: null } };
    expect(parts(email)).toEqual({ verb: "emailed", status: { tone: "good", word: "Delivered" }, detail: null });
  });
  it("a row's time is the ACCOUNT's clock (mutation: format row.time in UTC -> 4:12 PM, FAILS)", () => {
    expect(rows([task(null)])[0]!.time).toBe("Oct 9, 2026, 11:12 AM");
  });
});

describe("timelineRows: the member a group row is about (S-03 part 2b, C6)", () => {
  const subjects = {
    c1: { label: "Ana García", href: "/dashboard/accounts/a1/contacts/c1" },
    c2: { label: "Luis García", href: "/dashboard/accounts/a1/contacts/c2" },
  };
  const entries: TimelineEntry[] = [
    { ...booking("booked"), contactId: "c2" } as TimelineEntry,
    { ...sms("outbound", "sent"), contactId: "c1" } as TimelineEntry,
    { ...call(60), contactId: "c9" } as TimelineEntry,
  ];
  it("with subjects every row names its own member and keeps its author mark, a customer's own row included (mutation: drop the mark when the customer wrote it and a subject is present -> FAILS)", () => {
    const tr = makeTr("en");
    const r = timelineRows(entries, { zone: "America/Chicago", tr, author: author(), subjects });
    expect(r.map((x) => x.subject)).toEqual([subjects.c2, subjects.c1, null]);
    expect(r.map((x) => [x.mark.kind, x.mark.label])).toEqual([["customer", "Customer"], ["person", "Someone on the team"], ["ai", "Sofía · AI"]]);
  });
  it("without subjects (the contact page) every row's subject is null (mutation: build a subject from entry.contactId always -> FAILS)", () => {
    expect(rows(entries).map((x) => x.subject)).toEqual([null, null, null]);
  });
});
