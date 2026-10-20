import { describe, it, expect } from "vitest";
import type { TimelineEntry } from "@bis/db";
import { authorOf, authorMark, personIdsOf, type AuthorCtx } from "./author-mark";
import { makeTr } from "./copy";

const AT = "2026-10-09T16:12:00+00:00";
const FIVE = ["person", "ai", "automation", "customer", "import"];
const task = (over: Record<string, unknown> = {}): TimelineEntry => ({ kind: "task", id: "t1", at: AT, contactId: "c1", task: {
  id: "t1", title: "x", due_at: null, completed_at: null, created_at: AT, consent_event_id: null, call_id: null,
  assigned_to: null, created_by: null, ...over } }) as unknown as TimelineEntry;
const message = (over: Record<string, unknown>): TimelineEntry => ({ kind: "message", id: "m1", at: AT, contactId: "c1", message: {
  id: "m1", channel: "sms", direction: "outbound", status: "sent", subject: null, body: "x", error: null, created_at: AT,
  author_kind: null, author_id: null, ...over } }) as unknown as TimelineEntry;
const booking = (author_kind: string | null): TimelineEntry => ({ kind: "booking", id: "b1", at: AT, contactId: "c1", booking: {
  id: "b1", created_at: AT, starts_at: AT, status: "booked", note: null, author_kind, author_id: null,
  rescheduled_from_id: null, moved_from_starts_at: null } as never });
const ENTRIES: [string, TimelineEntry, string][] = [
  ["note", { kind: "note", id: "n1", at: AT, contactId: "c1", note: { id: "n1", body: "x", author_id: "user_dan", created_at: AT } }, "person"],
  ["callback To-do", task({ call_id: "c1" }), "ai"],
  ["stop-hold To-do", task({ consent_event_id: "e1" }), "automation"],
  ["typed To-do", task({ created_by: "user_dan" }), "person"],
  ["deal", { kind: "deal", id: "d1", at: AT, contactId: "c1", deal: { id: "d1", name: "Deck", status: "open", monetary_value: 0, created_at: AT, created_by: null } }, "person"],
  ["web chat", { kind: "submission", id: "s1", at: AT, contactId: "c1", submission: { id: "s1", created_at: AT, formName: "Q", answers: [], author_kind: "ai" } }, "ai"],
  ["typed form", { kind: "submission", id: "s2", at: AT, contactId: "c1", submission: { id: "s2", created_at: AT, formName: "Q", answers: [], author_kind: "customer" } }, "customer"],
  ["recipe text", message({ author_kind: "automation" }), "automation"],
  ["staff email", message({ author_kind: "person", author_id: "user_dan", channel: "email" }), "person"],
  ["booking page", booking("customer"), "customer"],
  ["receptionist booking", booking("ai"), "ai"],
  ["call", { kind: "call", id: "k1", at: AT, contactId: "c1", call: { id: "k1", contact_id: "c1", started_at: AT, outcome: "booked", duration_secs: 60, reason: null, summary: "", language: "en" } }, "ai"],
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
  const note = (author_id: string | null): TimelineEntry => ({ kind: "note", id: "n", at: AT, contactId: "c1", note: { id: "n", body: "x", author_id, created_at: AT } });
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
    ["submission", { kind: "submission", id: "s9", at: AT, contactId: "c1", submission: { id: "s9", created_at: AT, formName: "Q", answers: [], author_kind: "robot" } } as unknown as TimelineEntry],
    // minors-1b item 4: before 0074 these two columns were nullable; the migration backfilled every
    // row and closed both with NOT NULL, so a real message or booking can no longer be null — this is
    // the SAME defence (never a sixth kind, never blank) as the "robot" cases above, now covering the
    // shape that used to need its own direction-based default (mutation: reintroduce that default ->
    // the inbound message reads "Customer" and the booking reads "Customer" instead, FAILS).
    ["message, null (pre-0074 shape, impossible since)", message({ direction: "inbound" })],
    ["booking, null (pre-0074 shape, impossible since)", booking(null)],
  ])("%s (mutation: pass the column through unchecked -> FAILS)", (_n, entry) => {
    expect(authorOf(entry)).toEqual({ kind: "person", personId: null });
    expect(authorMark(entry, ctx())).toEqual({ kind: "person", label: "Someone on the team" });
  });
});

describe("a document row's author (S-07, plan deviation 3)", () => {
  const doc: TimelineEntry = { kind: "document", id: "d1", at: AT, contactId: "c1", document: {
    id: "d1", title: "Signed lease", category: "contract", source: "upload", created_by: "user_ana", created_at: AT,
    deleted_at: null, contact_id: "c1", client_group_id: null } };
  it("is the person who added it, and the names read asks for them (mutation: return unnamed() for documents -> FAILS)", () => {
    expect(authorOf(doc)).toEqual({ kind: "person", personId: "user_ana" });
    expect(personIdsOf([doc])).toEqual(["user_ana"]);
  });
});

describe("a new version's author (owner ruling R2)", () => {
  const ver: TimelineEntry = { kind: "documentVersion", id: "v2", at: AT, contactId: "c1", version: {
    id: "v2", document_id: "d1", title: "Signed lease", category: "contract", uploaded_by: "user_bea", created_at: AT,
    deleted_at: null, contact_id: "c1", client_group_id: null } };
  it("is the person who uploaded it, and the names read asks for them (mutation: the document's creator, or unnamed() -> FAILS)", () => {
    expect(authorOf(ver)).toEqual({ kind: "person", personId: "user_bea" });
    expect(personIdsOf([ver])).toEqual(["user_bea"]);
  });
});

describe("a removed file's author (spec 3.5)", () => {
  const removed: TimelineEntry = { kind: "documentRemoved", id: "v9", at: AT, contactId: "c1", scan: {
    id: "v9", document_id: "d1", scan_status: "infected", scan_signature: null, scanned_at: AT, title: "Lease", category: "contract",
    deleted_at: null, contact_id: "c1", client_group_id: null } };
  it("is the automation, and asks the names read for nobody (mutation: a person mark with a null id -> FAILS)", () => {
    expect(authorOf(removed)).toEqual({ kind: "automation", personId: null });
    expect(personIdsOf([removed])).toEqual([]);
  });
});

describe("customer upload links' marks (S-07 2b)", () => {
  it("a customer's file and its versions carry the customer mark (mutation: drop the customer: branch -> person -> FAILS)", () => {
    const doc = { kind: "document", id: "d1", at: AT, contactId: "c1", document: { id: "d1", title: "Seguro", category: "insurance", source: "customer", created_by: "customer:r1", created_at: AT, deleted_at: null, contact_id: "c1", client_group_id: null } } as TimelineEntry;
    const ver = { kind: "documentVersion", id: "v2", at: AT, contactId: "c1", version: { id: "v2", document_id: "d1", title: "Seguro", category: "insurance", uploaded_by: "customer:r1", created_at: AT, deleted_at: null, contact_id: "c1", client_group_id: null } } as TimelineEntry;
    expect([authorOf(doc), authorOf(ver)]).toEqual([{ kind: "customer", personId: null }, { kind: "customer", personId: null }]);
    expect(personIdsOf([doc, ver])).toEqual([]);
  });
  it("a request row carries the person who asked (mutation: automation -> FAILS)", () => {
    const req = { kind: "documentRequest", id: "r1", at: AT, contactId: "c1", request: { id: "r1", items: [{ key: "id", category: "id", note: null }], channel: "text", created_by: "u_ana", created_at: AT, contact_id: "c1", client_group_id: null } } as TimelineEntry;
    expect(authorOf(req)).toEqual({ kind: "person", personId: "u_ana" });
  });
  it("a To-do opened for a request carries the automation mark (mutation: drop the document_request_id branch -> person -> FAILS)", () => {
    const task = { kind: "task", id: "t1", at: AT, contactId: "c1", task: { id: "t1", title: "Ana sent documents · Review", due_at: AT, completed_at: null, created_at: AT, consent_event_id: null, call_id: null, assigned_to: null, created_by: null, document_request_id: "r1" } } as TimelineEntry;
    expect(authorOf(task)).toEqual({ kind: "automation", personId: null });
  });
  it("an expiry To-do carries the automation mark, even with a created_by on the row (S-07 3a; mutation: drop the document_expiry_id branch -> person -> FAILS)", () => {
    const task = { kind: "task", id: "t1", at: AT, contactId: "c1", task: { id: "t1", title: "Ana's insurance expires on Nov 16", due_at: AT, completed_at: null, created_at: AT, consent_event_id: null, call_id: null, assigned_to: null, created_by: "user_x", document_expiry_id: "d1" } } as TimelineEntry;
    expect(authorOf(task)).toEqual({ kind: "automation", personId: null });
  });
});

describe("required-documents skip marks (S-07 2c)", () => {
  it("a skip carries the person who skipped, an un-skip the person who un-skipped (mutations: one personId for both; the automation mark -> FAILS)", () => {
    const skip = { id: "k1", category: "insurance", contact_id: "c1", skipped_by: "u_ana", created_at: AT, unskipped_by: "u_bo", unskipped_at: AT };
    const a = { kind: "documentSkip", id: "k1", at: AT, contactId: "c1", skip } as TimelineEntry;
    const b = { kind: "documentUnskip", id: "k1", at: AT, contactId: "c1", skip } as TimelineEntry;
    expect([authorOf(a), authorOf(b)]).toEqual([{ kind: "person", personId: "u_ana" }, { kind: "person", personId: "u_bo" }]);
  });
});

describe("a website chat row's author (S-06 part 3, G20)", () => {
  const chat = { kind: "chat", id: "m0", at: "2026-10-17T15:00:00Z", contactId: "k1",
    chat: { conversationId: "cv1", count: 12, matchedExisting: false } } as TimelineEntry;
  it("is the customer reaching the business, named Customer / Cliente, and asks the names read for nobody (mutation: kind 'ai' -> FAILS)", () => {
    expect(authorOf(chat)).toEqual({ kind: "customer", personId: null });
    expect(authorMark(chat, ctx()).label).toBe("Customer");
    expect(authorMark(chat, ctx({ tr: makeTr("es") })).label).toBe("Cliente");
    expect(personIdsOf([chat])).toEqual([]);
  });
});

describe("a share link's marks (S-07 3b, O1)", () => {
  it("a share is the sharer's (a person); its first open is the customer kind, worded as the link's recipient in both languages (O1; mutations: the person mark for the open; the plain 'Customer' word; a sixth kind -> FAILS)", () => {
    const share = { id: "s1", document_id: "d1", title: "Seguro 2026.pdf", category: "insurance", created_by: "u_ana", created_at: AT, first_opened_at: AT, contact_id: "c1", client_group_id: null, deleted_at: null };
    const shared = { kind: "documentShared", id: "s1", at: AT, contactId: "c1", share } as TimelineEntry;
    const opened = { kind: "documentShareOpened", id: "s1", at: AT, contactId: "c1", share } as TimelineEntry;
    expect([authorOf(shared), authorOf(opened)]).toEqual([{ kind: "person", personId: "u_ana" }, { kind: "customer", personId: null }]);
    expect(authorMark(opened, ctx())).toEqual({ kind: "customer", label: "The link's recipient" });
    expect(authorMark(opened, ctx({ tr: makeTr("es") }))).toEqual({ kind: "customer", label: "Quien recibió el enlace" });
    expect(authorMark({ kind: "chat", id: "x", at: AT, contactId: "c1", chat: { conversationId: "v", count: 1, matchedExisting: true } } as TimelineEntry, ctx()).label).toBe("Customer");
  });
});

// item 8b-2 (spec 5.4, 8.3): an accepted suggestion is the ACCEPTER's row, a person mark from the closed set,
// never Sofía's: she suggested it, a person decided it.
describe("an accepted suggestion's mark (item 8b-2)", () => {
  const suggestion = (decidedBy: string | null): TimelineEntry => ({
    kind: "suggestion", id: "p1", at: AT, contactId: "c1",
    suggestion: {
      proposal: {
        id: "p1", accountId: "a1", source: "call", callId: "k1", contactId: "c1", kind: "task",
        payload: { title: "Send the quote", dueAt: null }, evidence: "x", evidenceRef: {}, evidenceLang: "en",
        status: "accepted", expiredReason: null, appliedPayload: { title: "Send the quote", dueAt: null }, appliedRef: null,
        decidedAt: AT, decidedBy, undoneAt: null, undoneBy: null, expiresAt: "2026-11-08T16:12:00+00:00", createdAt: AT,
      },
      applied: { title: "Send the quote", dueAt: null },
    },
  }) as TimelineEntry;
  it("is the person who accepted it: named, You for the viewer, Someone on the team unnamed, in both languages; the names read asks for them (mutation: kind 'ai' -> FAILS)", () => {
    expect(authorOf(suggestion("user_dan"))).toEqual({ kind: "person", personId: "user_dan" });
    expect(authorMark(suggestion("user_dan"), ctx())).toEqual({ kind: "person", label: "Dan López" });
    expect(authorMark(suggestion("user_me"), ctx())).toEqual({ kind: "person", label: "You" });
    expect(authorMark(suggestion("user_me"), ctx({ tr: makeTr("es") }))).toEqual({ kind: "person", label: "Usted" });
    expect(authorMark(suggestion("user_gone"), ctx())).toEqual({ kind: "person", label: "Someone on the team" });
    expect(authorMark(suggestion("user_gone"), ctx({ tr: makeTr("es") }))).toEqual({ kind: "person", label: "Alguien del equipo" });
    expect(personIdsOf([suggestion("user_dan"), suggestion("user_gone")])).toEqual(["user_dan", "user_gone"]);
  });
});

// item 8c: an act Sofia (or the web chat) took live is hers, never a person's — Task 5 gives it the
// persona's own label; this is the type-only case only.
describe("an ai_acts row's mark (item 8c)", () => {
  const act: TimelineEntry = {
    kind: "aiAct", id: "a1", at: AT, contactId: "c1",
    act: {
      id: "a1", accountId: "acct1", actor: "voice", callId: "k1", chatId: null, contactId: "c1",
      kind: "contact_field_filled", target: { field: "firstName" }, before: { value: null }, after: { value: "Ana" },
      createdAt: AT, undoneAt: null, undoneBy: null, undoNotified: false,
    },
  } as unknown as TimelineEntry;
  it("is the ai mark (mutation: kind 'person' -> FAILS)", () => {
    expect(authorOf(act)).toEqual({ kind: "ai", personId: null });
    expect(authorMark(act, ctx()).kind).toBe("ai");
  });
});
