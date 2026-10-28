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

describe("recentRowsView's customer language (S-09 §9)", () => {
  const INBOUND_SMS = message(null);
  const OUTBOUND_SMS: TimelineEntry = { kind: "message", id: "m2", at: AT, contactId: "c1",
    message: { id: "m2", channel: "sms", direction: "outbound", status: "delivered", subject: null, body: "Claro, le escribimos", error: null,
      created_at: AT, author_kind: "person", author_id: "u1" } };

  it("an inbound text's excerpt takes the contact's language; an outbound one stays typed-unknown (mutation: ignore direction -> FAILS)", () => {
    const tr = makeTr("en");
    const rows = timelineRows([INBOUND_SMS, OUTBOUND_SMS], { zone: "UTC", tr, author: { viewerId: null, names: {}, personaName: null, tr } });
    expect(recentRowsView(rows, "es").map((r) => r.excerpt?.lang)).toEqual(["es", ""]);
    expect(recentRowsView(rows).map((r) => r.excerpt?.lang)).toEqual(["", ""]);
  });

  it("a customer's booking note takes the contact's language; a staff one (author_kind person) stays typed-unknown (mutation: drop the booking author_kind check -> FAILS)", () => {
    const staff: TimelineEntry = { ...booking, id: "b2", booking: { ...booking.booking, id: "b2", note: "Bring the long ladder", author_kind: "person", author_id: "u1" } };
    const tr = makeTr("en");
    const rows = timelineRows([booking, staff], { zone: "UTC", tr, author: { viewerId: null, names: { u1: "Ana" }, personaName: null, tr } });
    expect(recentRowsView(rows, "es").map((r) => [r.excerpt?.text, r.excerpt?.lang])).toEqual([["Gate code 4411", "es"], ["Bring the long ladder", ""]]);
  });
});

describe("a document in the drawer's Recent (S-07, plan deviation 3)", () => {
  it("is its head only, never an excerpt of its title (mutation: excerpt the title -> FAILS)", () => {
    const doc: TimelineEntry = { kind: "document", id: "d1", at: AT, contactId: "c1", document: {
      id: "d1", title: "Signed lease", category: "contract", source: "upload", created_by: "user_ana", created_at: AT,
      deleted_at: null, contact_id: "c1", client_group_id: null } };
    const [d] = view([doc]);
    expect([d!.kind, d!.verb, d!.excerpt]).toEqual(["document", "added a file: Signed lease", null]);
  });
});

describe("a new version in the drawer's Recent (owner ruling R2)", () => {
  it("is its head only, its own kind, never an excerpt (mutation: map it to kind 'document' -> FAILS)", () => {
    const ver: TimelineEntry = { kind: "documentVersion", id: "v2", at: AT, contactId: "c1", version: {
      id: "v2", document_id: "d1", title: "Signed lease", category: "contract", uploaded_by: "user_ana", created_at: AT,
      deleted_at: null, contact_id: "c1", client_group_id: null } };
    const [d] = view([ver]);
    expect([d!.kind, d!.verb, d!.excerpt]).toEqual(["documentVersion", "uploaded a new version of Signed lease", null]);
  });
});

describe("a removed file in the drawer's Recent (spec 3.5)", () => {
  const removed: TimelineEntry = { kind: "documentRemoved", id: "v9", at: AT, contactId: "c1", scan: {
    id: "v9", document_id: "d1", scan_status: "infected", scan_signature: "Heuristics.Encrypted.PDF", scanned_at: AT, title: "Lease", category: "contract",
    deleted_at: null, contact_id: "c1", client_group_id: null } };
  it("is its head only, its own kind, never an excerpt (mutation: map it to kind 'document' -> FAILS)", () => {
    const [d] = view([removed]);
    expect([d!.kind, d!.verb, d!.excerpt]).toEqual(["documentRemoved", "removed Lease: it had a virus", null]);
  });
  it("carries only the row's own words, never the version's raw scan data (mutation: spread the entry's scan onto the row -> FAILS)", () => {
    const [d] = view([removed]);
    expect(Object.keys(d!).sort()).toEqual(["dateTime", "detail", "excerpt", "key", "kind", "mark", "status", "time", "verb"]);
    const json = JSON.stringify([d]);
    expect(json).not.toContain("Heuristics.Encrypted.PDF");
    expect(json).not.toContain("scan_status");
  });
});

describe("a document request in the drawer's Recent (S-07 2b)", () => {
  it("is its head only, its own kind, never an excerpt of its items (mutation: return the items -> FAILS)", () => {
    const req = { kind: "documentRequest", id: "r1", at: AT, contactId: "c1", request: {
      id: "r1", items: [{ key: "other", category: "other", note: "Pool permit" }], channel: "text", created_by: "u_ana", created_at: AT,
      contact_id: "c1", client_group_id: null } } as TimelineEntry;
    const [d] = view([req]);
    expect([d!.kind, d!.verb, d!.excerpt]).toEqual(["documentRequest", "asked for 1 document", null]);
  });
});

describe("a required-document skip in the drawer's Recent (S-07 2c)", () => {
  it("a skip and an un-skip are each their head only, their own kind, no excerpt (mutation: return a detail as the excerpt -> FAILS)", () => {
    const skip = { id: "k1", category: "insurance", contact_id: "c1", skipped_by: "u_ana", created_at: AT, unskipped_by: "u_ana", unskipped_at: "2026-10-09T17:00:00Z" };
    const rows = view([
      { kind: "documentUnskip", id: "k1", at: "2026-10-09T17:00:00Z", contactId: "c1", skip },
      { kind: "documentSkip", id: "k1", at: AT, contactId: "c1", skip },
    ] as TimelineEntry[]);
    expect(rows.map((d) => [d.kind, d.verb, d.excerpt])).toEqual([
      ["documentUnskip", "marked Insurance as needed again", null],
      ["documentSkip", "marked Insurance as not needed", null],
    ]);
  });
});

describe("a website chat in the drawer's Recent (S-06 part 3, G18, G25)", () => {
  const chat = (matchedExisting: boolean): TimelineEntry => ({ kind: "chat", id: "m0", at: AT, contactId: "c1",
    chat: { conversationId: "cv1", count: 12, matchedExisting } });
  it("a matched chat's excerpt is the unconfirmed line in the page's language; an unmatched one has none (mutation: excerpt null always -> FAILS)", () => {
    const [matched, fresh] = view([chat(true), chat(false)]);
    expect(matched!.kind).toBe("chat");
    expect(matched!.verb).toBe("chatted with Sofía on your website");
    expect(matched!.detail).toBe("12 messages");
    expect(matched!.excerpt).toEqual({ text: "Matched by the phone or email they typed; not confirmed.", lang: "en", done: false });
    expect(fresh!.excerpt).toBeNull();
    expect(Object.keys(matched!).sort()).toEqual(["dateTime", "detail", "excerpt", "key", "kind", "mark", "status", "time", "verb"]);
  });
});

describe("a share link in the drawer's Recent (S-07 3b)", () => {
  it("a share and its first open are each their head only, no excerpt (mutation: return the title as the excerpt -> FAILS)", () => {
    const share = { id: "s1", document_id: "d1", title: "Seguro 2026.pdf", category: "insurance", created_by: "u1", created_at: AT, first_opened_at: "2026-10-09T17:00:00Z", contact_id: "c1", client_group_id: null, deleted_at: null };
    const rows = view([
      { kind: "documentShareOpened", id: "s1", at: "2026-10-09T17:00:00Z", contactId: "c1", share },
      { kind: "documentShared", id: "s1", at: AT, contactId: "c1", share },
    ] as TimelineEntry[]);
    expect(rows.map((d) => [d.kind, d.excerpt])).toEqual([["documentShareOpened", null], ["documentShared", null]]);
    expect(rows.map((d) => d.verb)).toEqual(["opened Seguro 2026.pdf", "shared Seguro 2026.pdf"]);
  });
});

describe("an ai_acts row in the drawer's Recent, type-only (item 8c)", () => {
  it("has no excerpt (mutation: return the act's `after` as the excerpt -> FAILS)", () => {
    const entry: TimelineEntry = {
      kind: "aiAct", id: "a1", at: AT, contactId: "c1",
      act: {
        id: "a1", accountId: "acct1", actor: "voice", callId: "k1", chatId: null, contactId: "c1",
        kind: "contact_field_filled", target: { field: "firstName" }, before: { value: null }, after: { value: "Ana" },
        createdAt: AT, undoneAt: null, undoneBy: null, undoNotified: false,
      },
    } as unknown as TimelineEntry;
    const rows = view([entry]);
    expect(rows[0]!.excerpt).toBeNull();
  });
});

describe("an archive/restore row in the drawer's Recent (contact archive)", () => {
  it("has no excerpt: the head already says it all (mutation: return a non-null excerpt for archive -> FAILS)", () => {
    const entry: TimelineEntry = { kind: "archive", id: "g1", at: AT, contactId: "c1",
      archive: { action: "archived", author_kind: "person", author_id: "user_me", sign: null } };
    expect(view([entry])[0]!.excerpt).toBeNull();
  });
});
