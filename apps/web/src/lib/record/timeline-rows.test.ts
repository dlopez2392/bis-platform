import { describe, it, expect } from "vitest";
import type { TimelineDocument, TimelineDocumentVersion, TimelineDocumentScan, TimelineEntry } from "@bis/db";
import { m } from "@/lib/messages";
import { timelineRows, timelineFailedText } from "./timeline-rows";
import { makeTr, type Tr } from "./copy";

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

describe("a document row (S-07, plan deviation 3)", () => {
  const doc = (over: Partial<TimelineDocument> = {}): TimelineEntry => ({
    kind: "document", id: "d1", at: "2026-10-13T15:00:00.000Z", contactId: "c1",
    document: { id: "d1", title: "Signed lease", category: "contract", source: "upload", created_by: "user_ana",
      created_at: "2026-10-13T15:00:00.000Z", deleted_at: null, contact_id: "c1", client_group_id: null, ...over },
  });
  const author = (tr: Tr) => ({ viewerId: "user_me", names: { user_ana: "Ana" }, personaName: null, tr });
  it("reads '<who> added a file: <title>', its category as the detail, the person mark; a camera file reads 'took a photo' (mutation: drop the camera branch -> FAILS)", () => {
    const tr = makeTr("en");
    const [row] = timelineRows([doc()], { zone: "America/Chicago", tr, author: author(tr) });
    expect([row!.verb, row!.detail, row!.mark, row!.status]).toEqual(["added a file: Signed lease", "Contract", { kind: "person", label: "Ana" }, null]);
    const [photo] = timelineRows([doc({ source: "camera" })], { zone: "America/Chicago", tr, author: author(tr) });
    expect(photo!.verb).toBe("took a photo: Signed lease");
  });
  it("a trashed file carries 'In the trash' as a dot and a word, in Spanish too (mutation: drop the trashed status -> FAILS)", () => {
    const tr = makeTr("es");
    const [row] = timelineRows([doc({ deleted_at: "2026-10-14T00:00:00.000Z" })], { zone: "America/Chicago", tr, author: author(tr) });
    expect(row!.status).toEqual({ tone: "muted", word: m["documents.status.trashed.es"] });
    expect(row!.verb).toBe(m["timeline.document.es"].replace("{title}", "Signed lease"));
    expect(row!.detail).toBe(m["documents.category.contract.es"]);
  });
  it("a failed documents source is named (mutation: drop documents from SOURCE_KEY -> typecheck FAILS; at runtime the word is missing)", () => {
    expect(timelineFailedText(["documents"], makeTr("en"))).toBe("Couldn't load documents.");
    expect(timelineFailedText(["documents"], makeTr("es"))).toBe(m["timeline.someFailed.es"].replace("{what}", m["timeline.what.documents.es"]));
  });
});

describe("a new version's row (owner ruling R2)", () => {
  const ver = (over: Partial<TimelineDocumentVersion> = {}): TimelineEntry => ({
    kind: "documentVersion", id: "v2", at: "2026-10-14T15:00:00.000Z", contactId: "c1",
    version: { id: "v2", document_id: "d1", title: "Signed lease", category: "contract", uploaded_by: "user_ana",
      created_at: "2026-10-14T15:00:00.000Z", deleted_at: null, contact_id: "c1", client_group_id: null, ...over },
  });
  const author = (tr: Tr) => ({ viewerId: "user_me", names: { user_ana: "Ana" }, personaName: null, tr });
  it("reads '<who> uploaded a new version of <title>', the category as detail, the person mark (mutation: reuse timeline.document -> FAILS)", () => {
    const tr = makeTr("en");
    const [row] = timelineRows([ver()], { zone: "America/Chicago", tr, author: author(tr) });
    expect([row!.verb, row!.detail, row!.mark, row!.status, row!.key]).toEqual(
      ["uploaded a new version of Signed lease", "Contract", { kind: "person", label: "Ana" }, null, "documentVersion-v2"]);
  });
  it("in Spanish, and a trashed file's version carries 'In the trash' as a dot and a word (mutation: drop the trashed status -> FAILS)", () => {
    const tr = makeTr("es");
    const [row] = timelineRows([ver({ deleted_at: "2026-10-15T00:00:00.000Z" })], { zone: "America/Chicago", tr, author: author(tr) });
    expect(row!.verb).toBe(m["timeline.documentVersion.es"].replace("{title}", "Signed lease"));
    expect(row!.status).toEqual({ tone: "muted", word: m["documents.status.trashed.es"] });
  });
});

describe("a removed file's row (spec 3.5)", () => {
  const removed = (over: Partial<TimelineDocumentScan> = {}): TimelineEntry => ({
    kind: "documentRemoved", id: "v9", at: "2026-10-15T15:00:00.000Z", contactId: "c1",
    scan: { id: "v9", document_id: "d1", scan_status: "infected", scan_signature: null, scanned_at: "2026-10-15T15:00:00.000Z", title: "Lease",
      category: "contract", deleted_at: null, contact_id: "c1", client_group_id: null, ...over },
  });
  const author = (tr: Tr) => ({ viewerId: "user_me", names: {}, personaName: null, tr });
  it("reads 'Automation removed <title>: it had a virus', a crit dot and word, the category as detail (mutations: reuse timeline.documentVersion -> FAILS; tone 'muted' -> FAILS)", () => {
    const tr = makeTr("en");
    const [row] = timelineRows([removed()], { zone: "America/Chicago", tr, author: author(tr) });
    expect([row!.verb, row!.detail, row!.mark, row!.status, row!.key]).toEqual([
      "removed Lease: it had a virus", "Contract", { kind: "automation", label: "Automation" },
      { tone: "crit", word: "Removed: it had a virus" }, "documentRemoved-v9"]);
  });
  it("in Spanish, and an unscannable file reads its own words (mutation: one verb for both states -> FAILS)", () => {
    const tr = makeTr("es");
    const [row] = timelineRows([removed({ scan_status: "unscannable" })], { zone: "America/Chicago", tr, author: author(tr) });
    expect(row!.verb).toBe(m["timeline.documentUnscannable.es"].replace("{title}", "Lease"));
    expect(row!.status).toEqual({ tone: "crit", word: m["documents.status.unscannable.es"] });
    expect(row!.mark).toEqual({ kind: "automation", label: m["provenance.automation.es"] });
  });
  it("a password-protected file's row says so, in both languages, never the generic words (owner ruling 2026-10-15; mutation: ignore the cause -> the generic verb -> FAILS)", () => {
    for (const locale of ["en", "es"] as const) {
      const tr = makeTr(locale);
      const [row] = timelineRows([removed({ scan_status: "unscannable", scan_signature: "Heuristics.Encrypted.PDF" })], { zone: "America/Chicago", tr, author: author(tr) });
      const sfx = locale === "es" ? ".es" : "";
      expect(row!.verb).toBe(m[`timeline.documentPassword${sfx}` as keyof typeof m].replace("{title}", "Lease"));
      expect(row!.status).toEqual({ tone: "crit", word: m[`documents.status.passwordRemoved${sfx}` as keyof typeof m] });
      expect(row!.verb).not.toBe(m[`timeline.documentUnscannable${sfx}` as keyof typeof m].replace("{title}", "Lease"));
    }
  });
});
