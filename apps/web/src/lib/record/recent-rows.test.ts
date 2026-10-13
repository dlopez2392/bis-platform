import { describe, it, expect } from "vitest";
import type { TimelineEntry } from "@bis/db";
import { timelineRows } from "./timeline-rows";
import { recentRowsView } from "./recent-rows";
import { makeTr } from "./copy";

const AT = "2026-10-09T16:12:00Z";
const view = (entries: TimelineEntry[]) =>
  recentRowsView(timelineRows(entries, { zone: "America/Chicago", tr: makeTr("en"), author: { viewerId: null, names: {}, personaName: null, tr: makeTr("en") } }));
const call = (reason: string | null, summary: string): TimelineEntry => ({ kind: "call", id: "k1", at: AT, contactId: "c1",
  call: { id: "k1", contact_id: "c1", started_at: AT, outcome: "booked", duration_secs: 120, reason, summary, language: "es" } });
const booking: TimelineEntry = { kind: "booking", id: "b1", at: AT, contactId: "c1",
  booking: { id: "b1", contact_id: "c1", created_at: AT, starts_at: "2026-10-16T15:00:00Z", status: "booked", note: "Gate code 4411",
    author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } };
const task = (done: boolean): TimelineEntry => ({ kind: "task", id: "t1", at: AT, contactId: "c1", task: { id: "t1", title: "Call back about the gutters",
  due_at: null, completed_at: done ? AT : null, created_at: AT, consent_event_id: null, call_id: null, assigned_to: null, created_by: null } });
const deal: TimelineEntry = { kind: "deal", id: "d1", at: AT, contactId: "c1",
  deal: { id: "d1", name: "Deck build", status: "open", monetary_value: 1200, created_at: AT, created_by: null } };
const submission: TimelineEntry = { kind: "submission", id: "s1", at: AT, contactId: "c1",
  submission: { id: "s1", created_at: AT, formName: "Contact us", answers: [{ key: "message", label: "Message", value: "Leak" }], author_kind: "customer" } };
const message = (subject: string | null): TimelineEntry => ({ kind: "message", id: "m1", at: AT, contactId: "c1",
  message: { id: "m1", channel: "email", direction: "inbound", status: "delivered", subject, body: "The body", error: null, created_at: AT,
    author_kind: "customer", author_id: null } });

describe("recentRowsView (S-03 part 3 C6, §9.4): the drawer's compact rows", () => {
  it("every row keeps its author mark; the booking page's booking is the customer's (mutation: drop the mark for customer -> FAILS)", () => {
    const [b] = view([booking]);
    expect(b!.mark).toEqual({ kind: "customer", label: "Customer" });
    expect(b!.verb).toBe("booked an appointment for Fri, Oct 16, 10:00 AM");
    expect(b!.status).toEqual({ tone: "accent", word: "Booked" });
  });

  it("a call's reason as typed (lang=\"\"), else its summary's prose in English, else nothing on a mismatch (mutation: show the summary anyway -> FAILS)", () => {
    expect(view([call("Wants a roof quote", "Roof leak, booked.")])[0]!.excerpt).toEqual({ text: "Wants a roof quote", lang: "", done: false });
    expect(view([call(null, "Roof leak, booked.")])[0]!.excerpt).toEqual({ text: "Roof leak, booked.", lang: "en", done: false });
    expect(view([call(null, "⚠ MISMATCH the summary says booked; no booking was made\n\nRoof leak, booked.")])[0]!.excerpt).toBeNull();
  });

  it("a deal and a submission have no excerpt: the name and the form are in the verb (mutation: excerpt the form's answers -> FAILS)", () => {
    const [d, s] = view([deal, submission]);
    expect(d!.excerpt).toBeNull();
    expect(s!.excerpt).toBeNull();
    expect(s!.verb).toBe("sent the Contact us form");
  });

  it("a To-do's title as typed, struck through once done; a message's subject before its body; a booking's note (mutation: done always false -> FAILS)", () => {
    expect(view([task(false)])[0]!.excerpt).toEqual({ text: "Call back about the gutters", lang: "", done: false });
    expect(view([task(true)])[0]!.excerpt).toEqual({ text: "Call back about the gutters", lang: "", done: true });
    expect(view([message("Quote")])[0]!.excerpt!.text).toBe("Quote");
    expect(view([message(null)])[0]!.excerpt!.text).toBe("The body");
    expect(view([booking])[0]!.excerpt).toEqual({ text: "Gate code 4411", lang: "", done: false });
  });

  it("JSON only: no TimelineEntry rides along, and it survives a JSON round trip unchanged (mutation: spread the row -> `entry` appears, FAILS)", () => {
    const rows = view([booking, call(null, "Roof leak, booked."), deal]);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["dateTime", "detail", "excerpt", "key", "kind", "mark", "status", "time", "verb"]);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
    expect(rows[0]!.dateTime).toBe(AT);
  });
});
