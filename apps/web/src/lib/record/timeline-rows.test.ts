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

describe("customer upload links' rows (S-07 2b)", () => {
  const AT = "2026-10-15T15:00:00.000Z";
  it("a request row reads 'asked for N documents' with the items in the reader's language (mutation: the One key for 2 -> FAILS)", () => {
    const req = (items: { key: string; category: string; note: string | null }[]) => ({ kind: "documentRequest", id: "r1", at: AT, contactId: "c1",
      request: { id: "r1", items, channel: "text", created_by: "u1", created_at: AT, contact_id: "c1", client_group_id: null } }) as TimelineEntry;
    const two = [{ key: "insurance", category: "insurance", note: null }, { key: "other", category: "other", note: "Pool permit" }];
    for (const [locale, verb, detail] of [["en", "asked for 2 documents", "Insurance, Pool permit"], ["es", "pidió 2 documentos", `${m["documents.category.insurance.es"]}, Pool permit`]] as const) {
      const [row] = rows([req(two)], locale);
      expect([row!.verb, row!.detail]).toEqual([verb, detail]);
    }
    expect(m["documents.category.insurance"]).toBe("Insurance");
    const [one] = rows([req([two[0]!])], "es");
    expect(one!.verb).toBe("pidió 1 documento");
  });
  it("a customer's file reads 'sent <title>' (mutation: keep 'added a file' for source customer -> FAILS)", () => {
    const doc = { kind: "document", id: "d1", at: AT, contactId: "c1", document: { id: "d1", title: "Seguro", category: "insurance", source: "customer", created_by: "customer:r1", created_at: AT, deleted_at: null, contact_id: "c1", client_group_id: null } } as TimelineEntry;
    expect(rows([doc], "en")[0]!.verb).toBe("sent Seguro");
    expect(rows([doc], "es")[0]!.verb).toBe("mandó Seguro");
    expect(rows([doc], "en")[0]!.mark).toEqual({ kind: "customer", label: "Customer" });
  });
});

describe("required-documents skip rows (S-07 2c)", () => {
  const AT = "2026-10-16T15:00:00.000Z";
  it("a skip reads 'marked Insurance as not needed', an un-skip 'marked … as needed again', and their keys differ (mutations: one key for both; the category's raw key -> FAILS)", () => {
    const skip = { id: "k1", category: "insurance", contact_id: "c1", skipped_by: "u1", created_at: AT, unskipped_by: "u1", unskipped_at: "2026-10-16T16:00:00.000Z" };
    const entries = [
      { kind: "documentUnskip", id: "k1", at: "2026-10-16T16:00:00.000Z", contactId: "c1", skip },
      { kind: "documentSkip", id: "k1", at: AT, contactId: "c1", skip },
    ] as TimelineEntry[];
    const en = rows(entries, "en");
    expect(en.map((r) => r.verb)).toEqual(["marked Insurance as needed again", "marked Insurance as not needed"]);
    const es = rows(entries, "es");
    expect(es.map((r) => r.verb)).toEqual(["marcó que Seguro hace falta otra vez", "marcó que Seguro no hace falta"]);
    expect(en.map((r) => [r.status, r.detail])).toEqual([[null, null], [null, null]]);
    expect(new Set(en.map((r) => r.key)).size).toBe(2);
  });
});

describe("a share link's rows (S-07 3b)", () => {
  const AT = "2026-10-16T15:00:00.000Z";
  it("a share reads 'shared <title>' and its first open 'opened <title>', both languages, the category as detail, a trashed file's status, distinct keys (mutations: one verb for both; no trashed status -> FAILS)", () => {
    const share = { id: "s1", document_id: "d1", title: "Seguro 2026.pdf", category: "insurance", created_by: "u1", created_at: AT, first_opened_at: "2026-10-16T16:00:00.000Z", contact_id: "c1", client_group_id: null, deleted_at: "2026-10-17T10:00:00.000Z" };
    const entries = [
      { kind: "documentShareOpened", id: "s1", at: "2026-10-16T16:00:00.000Z", contactId: "c1", share },
      { kind: "documentShared", id: "s1", at: AT, contactId: "c1", share },
    ] as TimelineEntry[];
    const en = timelineRows(entries, { zone: "America/Chicago", tr: makeTr("en"), author: author("en") });
    expect(en.map((r) => [r.verb, r.detail, r.status?.word])).toEqual([
      ["opened Seguro 2026.pdf", "Insurance", "In the trash"], ["shared Seguro 2026.pdf", "Insurance", "In the trash"]]);
    const es = timelineRows(entries, { zone: "America/Chicago", tr: makeTr("es"), author: author("es") });
    expect(es.map((r) => r.verb)).toEqual(["abrió Seguro 2026.pdf", "compartió Seguro 2026.pdf"]);
    expect(new Set(en.map((r) => r.key)).size).toBe(2);
  });
});

describe("a website chat row (S-06 part 3, spec §7, G18, G23, G24)", () => {
  const chat = (count: number, matchedExisting: boolean): TimelineEntry => ({ kind: "chat", id: "m0", at: "2026-10-17T15:00:00Z", contactId: "k1",
    chat: { conversationId: "cv1", count, matchedExisting } });
  const one = (e: TimelineEntry, locale: "en" | "es" = "en", personaName: string | null = "Rosa", pseudo = false) => {
    const tr = makeTr(locale, pseudo);
    return timelineRows([e], { zone: "America/Chicago", tr, author: { viewerId: null, names: {}, personaName, tr } })[0]!;
  };
  it("names the account's persona, counts the messages, has no status and, for a new customer, no line (mutations: hard-code Sofía -> FAILS; the line on every chat -> FAILS)", () => {
    const r = one(chat(12, false));
    expect([r.verb, r.detail, r.status]).toEqual(["chatted with Rosa on your website", "12 messages", null]);
    expect(r.mark).toEqual({ kind: "customer", label: "Customer" });
    expect("note" in r).toBe(false);
    expect(one(chat(1, false)).detail).toBe("1 message");
    expect(one(chat(12, false), "en", null).verb).toBe("chatted with Sofía on your website");
    expect(one(chat(12, false), "en", "  ").verb).toBe("chatted with Sofía on your website");
  });
  it("in Spanish (mutation: read the words from m[...] -> English, FAILS)", () => {
    const r = one(chat(12, false), "es");
    expect([r.verb, r.detail]).toEqual(["conversó con Rosa en su sitio web", "12 mensajes"]);
    expect(one(chat(1, false), "es").detail).toBe("1 mensaje");
  });
  it("a chat matched to an existing customer carries the unconfirmed line in the page's language (G18; mutation: drop the note -> FAILS)", () => {
    expect(one(chat(3, true)).note).toEqual({ text: "Matched by the phone or email they typed; not confirmed.", lang: "en" });
    expect(one(chat(3, true), "es").note).toEqual({ text: "Lo relacionamos por el teléfono o el correo que escribió; no está confirmado.", lang: "es" });
  });
  it("no other kind carries a note key at all (mutation: note: undefined on every row -> FAILS)", () => {
    const r = one({ kind: "note", id: "n1", at: "2026-10-17T15:00:00Z", contactId: "k1", note: { id: "n1", body: "x", author_id: null, created_at: "2026-10-17T15:00:00Z" } });
    expect("note" in r).toBe(false);
  });
  it("a failed chats source is named (G24)", () => {
    expect(timelineFailedText(["chats"], makeTr("en"))).toBe("Couldn't load website chats.");
    expect(timelineFailedText(["chats"], makeTr("es"))).toBe("No se pudo cargar: chats del sitio web.");
  });
  it("the pseudo-locale reaches the row's words (mutation: build the verb without tr -> the plain string, FAILS)", () => {
    const r = one(chat(12, true), "en", "Rosa", true);
    expect(r.verb).not.toBe("chatted with Rosa on your website");
    expect(r.detail).not.toBe("12 messages");
    expect(r.note!.text).not.toBe("Matched by the phone or email they typed; not confirmed.");
  });
});

// item 8b-2 (spec 5.4, 7): "{person} accepted Rosa's suggestion: <what was written>", the accepter's person
// mark, the original as the detail when it was changed first.
describe("an accepted suggestion row (item 8b-2)", () => {
  const AT = "2026-10-09T16:12:00+00:00";
  type Kinded = { kind: "task"; payload: { title: string; dueAt: string | null } }
    | { kind: "contact_field"; payload: { field: "email"; value: string } }
    | { kind: "opportunity_stage"; payload: { opportunityId: string; fromStageId: string; toStageId: string } };
  const suggestion = (status: "accepted" | "edited", proposed: Kinded, applied: Kinded["payload"] | null): TimelineEntry => ({
    kind: "suggestion", id: "p1", at: AT, contactId: "c1",
    suggestion: {
      proposal: {
        id: "p1", accountId: "a1", source: "call", callId: "k1", contactId: "c1", ...proposed, evidence: "x", evidenceRef: {},
        evidenceLang: "en", status, expiredReason: null, appliedPayload: applied, appliedRef: null, decidedAt: AT,
        decidedBy: "user_dan", undoneAt: null, undoneBy: null, expiresAt: "2026-11-08T16:12:00+00:00", createdAt: "2026-10-08T16:12:00+00:00",
      },
      applied,
    },
  }) as TimelineEntry;
  const one = (entry: TimelineEntry, locale: "en" | "es" = "en", stages: Record<string, { name: string; position: number }> | undefined = undefined, personaName: string | null = "Rosa") =>
    timelineRows([entry], {
      zone: "America/Chicago", tr: makeTr(locale), author: { viewerId: null, names: { user_dan: "Dan López" }, personaName, tr: makeTr(locale) },
      ...(stages ? { suggestionStages: stages } : {}),
    })[0]!;
  const task = (dueAt: string | null): Kinded => ({ kind: "task", payload: { title: "Send the quote", dueAt } });

  it("an accepted to-do names the persona, says what was written, and its due date as it read when accepted, never 'Was due' later (mutation: describe at today's clock -> 'Was due', FAILS)", () => {
    const r = one(suggestion("accepted", task("2026-10-12T15:00:00Z"), { title: "Send the quote", dueAt: "2026-10-12T15:00:00Z" }));
    expect([r.verb, r.detail, r.status, r.mark]).toEqual([
      "accepted Rosa's suggestion: Add a to-do: Send the quote", "Due Oct 12, 2026", null, { kind: "person", label: "Dan López" },
    ]);
    expect(r.key).toBe("suggestion-p1");
  });

  it("with no persona on the account it is Sofía's suggestion (the AI mark's own rule)", () => {
    expect(one(suggestion("accepted", task(null), { title: "Send the quote", dueAt: null }), "en", undefined, null).verb)
      .toBe("accepted Sofía's suggestion: Add a to-do: Send the quote");
  });

  it("edited reads 'with changes', describes what was WRITTEN, and the original is the detail, in English and Spanish (mutations: describe the proposal, not the applied form -> FAILS; drop the original -> FAILS)", () => {
    const entry = suggestion("edited", { kind: "contact_field", payload: { field: "email", value: "ana@exmaple.com" } }, { field: "email", value: "ana@example.com" });
    const en = one(entry);
    expect([en.verb, en.detail]).toEqual([
      "accepted Rosa's suggestion with changes: Email: (empty) → ana@example.com", "Suggested: Email: (empty) → ana@exmaple.com",
    ]);
    const es = one(entry, "es");
    expect([es.verb, es.detail, es.mark.label]).toEqual([
      "aceptó la sugerencia de Rosa con cambios: Correo: (vacío) → ana@example.com", "Se sugirió: Correo: (vacío) → ana@exmaple.com", "Dan López",
    ]);
  });

  it("an accepted one in Spanish (mutation: read the words from m[...] -> English, FAILS)", () => {
    const r = one(suggestion("accepted", { kind: "contact_field", payload: { field: "email", value: "ana@example.com" } }, { field: "email", value: "ana@example.com" }), "es");
    expect([r.verb, r.detail]).toEqual(["aceptó la sugerencia de Rosa: Correo: (vacío) → ana@example.com", null]);
  });

  it("an applied form the read could not parse describes what was proposed (mutation: describe nothing -> FAILS)", () => {
    expect(one(suggestion("accepted", task(null), null)).verb).toBe("accepted Rosa's suggestion: Add a to-do: Send the quote");
  });

  it("a stage move with no stage names reads the registry's honest sentence; with them, the move (mutation: default suggestionStages to a stage name -> FAILS)", () => {
    const move = { opportunityId: "o1", fromStageId: "s1", toStageId: "s2" };
    const entry = suggestion("accepted", { kind: "opportunity_stage", payload: move }, move);
    expect(one(entry).verb).toBe("accepted Rosa's suggestion: Review the stage change on this deal.");
    expect(one(entry, "es").verb).toBe("aceptó la sugerencia de Rosa: Revise el cambio de etapa de esta oportunidad.");
    expect(one(entry, "en", { s1: { name: "Quoted", position: 1 }, s2: { name: "Won over", position: 2 } }).verb)
      .toBe("accepted Rosa's suggestion: Move from Quoted to Won over");
  });

  // Final review M-5 / design review I2b: the row is drawn from its parts, as the card is, so the model's
  // English title keeps lang="en" (P18) and the arrow is drawn aria-hidden beside its spoken word.
  it("the verb and an edited row's original carry their parts: the model's title keeps lang en, the arrow is drawn but spoken (mutation: one joined text part -> FAILS)", () => {
    const t = one(suggestion("accepted", task(null), { title: "Send the quote", dueAt: null }));
    expect(t.verbParts).toEqual([
      { text: "accepted Rosa's suggestion: " }, { text: "Add a to-do: " }, { text: "Send the quote", lang: "en" },
    ]);
    expect(t.detailParts).toBeUndefined();
    const entry = suggestion("edited", { kind: "contact_field", payload: { field: "email", value: "ana@exmaple.com" } }, { field: "email", value: "ana@example.com" });
    const en = one(entry);
    expect(en.verbParts).toEqual([
      { text: "accepted Rosa's suggestion with changes: " }, { text: "Email: (empty) " }, { text: "→", spoken: "to" }, { text: " ana@example.com" },
    ]);
    expect(en.detailParts).toEqual([{ text: "Suggested: " }, { text: "Email: (empty) " }, { text: "→", spoken: "to" }, { text: " ana@exmaple.com" }]);
    const es = one(entry, "es");
    expect(es.verbParts?.find((p) => p.spoken)).toEqual({ text: "→", spoken: "a" });
    // The strings stay the drawn sentence, for anything that reads the row as text.
    expect(en.verb).toBe((en.verbParts ?? []).map((p) => p.text).join(""));
  });

  it("the pseudo-locale's verb parts still split around the change (mutation: interpolate the joined change text instead of splitting -> no English title part, FAILS)", () => {
    const p = timelineRows([suggestion("accepted", task(null), { title: "Send the quote", dueAt: null })], {
      zone: "America/Chicago", tr: makeTr("en", true), author: { viewerId: null, names: {}, personaName: "Rosa", tr: makeTr("en", true) },
    })[0]!;
    expect(p.verbParts?.some((x) => x.text === "Send the quote" && x.lang === "en")).toBe(true);
    expect(p.verbParts?.[0]?.text.startsWith("[")).toBe(true);
    expect(p.verbParts?.at(-1)?.text.endsWith("]")).toBe(true);
  });

  it("a failed suggestions source is named in both languages", () => {
    expect(timelineFailedText(["suggestions"], makeTr("en"))).toBe("Couldn't load accepted suggestions.");
    expect(timelineFailedText(["suggestions"], makeTr("es"))).toBe("No se pudo cargar: sugerencias aceptadas.");
  });
});

// item 8c (plan Task 5 item 7): an act's row reads the act-kind registry's sentence, marked as Sofía's, and
// carries its built view (the Undo state the row draws). Task 3's empty placeholder is gone on purpose.
describe("an ai_acts row (item 8c)", () => {
  const actEntry = (over: Record<string, unknown> = {}): TimelineEntry => ({
    kind: "aiAct", id: "a1", at: "2026-10-09T16:12:00+00:00", contactId: "c1",
    act: {
      id: "a1", accountId: "acct1", actor: "voice", callId: "k1", chatId: null, contactId: "c1",
      kind: "contact_field_filled", target: { field: "firstName" }, before: { value: null }, after: { value: "Ana" },
      createdAt: "2026-10-09T16:12:00+00:00", undoneAt: null, undoneBy: null, undoNotified: false, ...over,
    },
  } as unknown as TimelineEntry);
  const facts = { now: new Date("2026-10-10T00:00:00Z"), bookings: {}, contact: { first_name: "Ana", email: null }, heldBy: {}, editors: {}, canDelete: true, futureBooked: [] };
  const ctx = (locale: "en" | "es" = "en", actFacts: typeof facts | null | undefined = facts) => ({
    zone: "America/Chicago", tr: makeTr(locale), actFacts,
    author: { viewerId: "user_me", names: { user_ana: "Ana López" }, personaName: "Lupe", tr: makeTr(locale) },
  });

  it("reads the registry's sentence under the AI mark, with no status, and carries the row's view (mutation: keep the empty verb -> FAILS)", () => {
    const r = timelineRows([actEntry()], ctx())[0]!;
    expect([r.verb, r.status, r.detail, r.mark]).toEqual(["filled in the first name: Ana", null, null, { kind: "ai", label: "Lupe · AI" }]);
    expect(r.act).toMatchObject({ id: "a1", verb: "filled in the first name: Ana", source: { href: "/dashboard/accounts/acct1/calls/k1" },
      undo: { state: "available", control: "field", fieldLabel: "first name" } });
    expect(timelineRows([actEntry()], ctx("es"))[0]!.verb).toBe("completó el nombre: Ana");
  });

  it("a failed facts read leaves the row, without an Undo (mutation: treat null facts as safe -> FAILS)", () => {
    expect(timelineRows([actEntry()], ctx("en", null))[0]!.act!.undo).toEqual({ state: "unknown" });
    const noFacts = { zone: "America/Chicago", tr: makeTr("en"), author: ctx("en").author };
    expect(timelineRows([actEntry()], noFacts)[0]!.act!.undo).toEqual({ state: "unknown" });
  });

  it("an undone act names who undid it from the page's one names read", () => {
    const r = timelineRows([actEntry({ undoneAt: "2026-10-09T18:00:00+00:00", undoneBy: "user_ana" })], ctx())[0]!;
    expect(r.act!.undo).toEqual({ state: "undone", line: "Undone by Ana López · Oct 9, 2026" });
  });

  it("no other kind of row carries an act view", () => {
    expect(rows([call(60)])[0]!.act).toBeUndefined();
  });
});

describe("an archive/restore row's phrase (contact archive, spec §6.2)", () => {
  const AT = "2026-10-09T16:12:00Z";
  const archiveEntry = (
    action: "archived" | "restored", author_kind: "person" | "customer",
    sign: "text" | "email" | "call" | "booking" | "form" | "chat" | null = null,
  ): TimelineEntry => ({ kind: "archive", id: "g1", at: AT, contactId: "c1",
    archive: { action, author_kind, author_id: author_kind === "person" ? "user_dan" : null, sign } });
  it("a person's archive reads 'archived this contact', no status, no detail (mutation: map every customer row to timeline.restored -> FAILS)", () => {
    const [r] = rows([archiveEntry("archived", "person")]);
    expect([r!.verb, r!.status, r!.detail]).toEqual(["archived this contact", null, null]);
  });
  it("a person's own restore reads 'moved this contact back to the list' (mutation: always read a Came back phrase -> FAILS)", () => {
    expect(rows([archiveEntry("restored", "person")])[0]!.verb).toBe("moved this contact back to the list");
  });
  it("a customer's own sign restore reads 'Came back', keyed by the sign, under the customer mark (mutation: map every customer row to timeline.restored -> FAILS)", () => {
    const [r] = rows([archiveEntry("restored", "customer", "text")]);
    expect(r!.verb).toBe("came back: sent you a text");
    expect(r!.mark).toEqual({ kind: "customer", label: "Customer" });
    expect(rows([archiveEntry("restored", "customer", "call")])[0]!.verb).toBe("came back: called and talked with Sofía");
  });
  it("a call that brought them back names the account's own AI persona, not a fixed Sofía (final review M6; mutation: drop { persona } -> FAILS)", () => {
    const withPersona = (locale: "en" | "es") => ({
      zone: "America/Chicago", tr: makeTr(locale), author: { viewerId: null, names: {}, personaName: "Rosa", tr: makeTr(locale) },
    });
    const entry = archiveEntry("restored", "customer", "call");
    expect(timelineRows([entry], withPersona("en"))[0]!.verb).toBe("came back: called and talked with Rosa");
    expect(timelineRows([entry], withPersona("es"))[0]!.verb).toBe("volvió: llamó y habló con Rosa");
  });
  it("in Spanish (mutation: build labels from m[...] -> English, FAILS)", () => {
    expect(rows([archiveEntry("archived", "person")], "es")[0]!.verb).toBe("archivó este contacto");
    expect(rows([archiveEntry("restored", "customer", "booking")], "es")[0]!.verb).toBe("volvió: hizo una cita");
  });
});

describe("a merge/mergeUndone row's phrase (F-006 part 1, plan Task 9)", () => {
  const AT = "2026-10-09T16:12:00Z";
  const TM = (over: Record<string, unknown> = {}) => ({
    mergeId: "1", otherId: "c9", otherFirstName: "Other", otherLastName: "Person", otherVisible: true,
    mergedBy: "user_dan", mergedAt: AT, undoUntil: AT, undoneAt: null, undoneBy: null, counts: {}, ...over,
  });
  const mergeEntry = (over: Record<string, unknown> = {}): TimelineEntry =>
    ({ kind: "merge", id: "1", at: AT, contactId: "c1", merge: TM(over) }) as TimelineEntry;
  const undoneEntry = (over: Record<string, unknown> = {}): TimelineEntry =>
    ({ kind: "mergeUndone", id: "1", at: AT, contactId: "c1", merge: TM(over) }) as TimelineEntry;

  it("names the other record and what moved, in words joined by Intl.ListFormat (mutation: hard-code a comma -> FAILS)", () => {
    const [r] = rows([mergeEntry({ counts: { messages: 2, calls: 1 } })]);
    expect(r!.verb).toBe("merged Other Person into this record: 2 messages and 1 call moved here");
    expect([r!.status, r!.detail]).toEqual([null, null]);
  });

  it("with nothing to move, reads the empty form (mutation: always read timeline.merged -> FAILS)", () => {
    expect(rows([mergeEntry({ counts: {} })])[0]!.verb).toBe("merged Other Person into this record");
  });

  it("with the other record hidden by RLS, names 'another record' instead (mutation: ignore otherVisible -> FAILS)", () => {
    const [r] = rows([mergeEntry({ otherVisible: false, otherFirstName: null, otherLastName: null, counts: { notes: 1 } })]);
    expect(r!.verb).toBe("merged another record into this record: 1 note moved here");
  });

  it("a mergeUndone row names who undid it and the other record (mutation: drop the name -> FAILS)", () => {
    expect(rows([undoneEntry()])[0]!.verb).toBe("undid the merge with Other Person");
  });

  it("in Spanish (mutation: build from m[...] in English -> FAILS)", () => {
    expect(rows([mergeEntry({ counts: { notes: 1 } })], "es")[0]!.verb).toBe("unió a Other Person con este registro: 1 nota pasó aquí");
    expect(rows([undoneEntry()], "es")[0]!.verb).toBe("deshizo la unión con Other Person");
  });

  // S-10 T9a: "{list} moved here" agrees with the TOTAL count of things
  // moved, never the plain "other" form regardless of count — found live
  // as "1 nota pasaron aquí" (plural verb on a singular subject).
  it("the Spanish verb agrees with how many things moved in total, not with the number of nonzero categories (mutation: always use the plural 'pasaron' -> FAILS)", () => {
    // One category, one item: singular.
    expect(rows([mergeEntry({ counts: { notes: 1 } })], "es")[0]!.verb)
      .toBe("unió a Other Person con este registro: 1 nota pasó aquí");
    // One category, several items: plural.
    expect(rows([mergeEntry({ counts: { notes: 3 } })], "es")[0]!.verb)
      .toBe("unió a Other Person con este registro: 3 notas pasaron aquí");
    // Two categories, each with 1 (so 2 items total): plural, even though
    // every INDIVIDUAL phrase in the list is itself singular.
    expect(rows([mergeEntry({ counts: { notes: 1, calls: 1 } })], "es")[0]!.verb)
      .toBe("unió a Other Person con este registro: 1 llamada y 1 nota pasaron aquí");
  });

  it("WHAT names the merge source for the 'couldn't load' line (mutation: no merge key -> FAILS)", () => {
    expect(timelineFailedText(["merge"], makeTr("en"))).toBe("Couldn't load merge history.");
  });
});
