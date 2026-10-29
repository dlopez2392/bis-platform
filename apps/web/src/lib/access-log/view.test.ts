import { describe, expect, it } from "vitest";
import type { AccessLogCounts, AccessLogItem, AccessLogPage, AccessLogVisit } from "@bis/db";
import { makeTr } from "@/lib/record/copy";
import { encodeCursor } from "@/lib/cursor";
import {
  buildVisitRows, encodeAccessCursor, parseAccessCursor, visitSpan, visitSummary, type AccessLogNames,
} from "./view";

/**
 * F-118 part 1 (plan Task 4, step 1). Pure — no React, no I/O — built on T1's typed page and T4's own
 * name lookup (names.ts). Every case builds a `Tr` with `makeTr("en")`/`makeTr("es")`.
 */

const trEn = makeTr("en");
const trEs = makeTr("es");
const ZONE = "America/Chicago";
const BASE = "/dashboard/accounts/A1";

const ZERO: AccessLogCounts = {
  contact: 0, group: 0, call: 0, conversation: 0, file: 0, form_answers: 0, customer_list_export: 0,
};

describe("visitSummary", () => {
  it("counts customers, a call and a file, in the spec's fixed order, whatever order the object lists them (mutation: Object.keys(counts) order -> FAILS)", () => {
    // Scrambled on purpose: file and call are written before contact.
    const counts: AccessLogCounts = { file: 1, call: 1, group: 0, conversation: 0, contact: 4, form_answers: 0, customer_list_export: 0 };
    expect(visitSummary(counts, trEn)).toBe("Opened 4 customers, 1 call and 1 file.");
    expect(visitSummary(counts, trEs)).toBe("Abrió 4 clientes, 1 llamada y 1 archivo.");
  });

  it("a single customer is singular, not the plural form (mutation: always render the plural form -> FAILS)", () => {
    const counts: AccessLogCounts = { ...ZERO, contact: 1 };
    expect(visitSummary(counts, trEn)).toBe("Opened 1 customer.");
    expect(visitSummary(counts, trEs)).toBe("Abrió 1 cliente.");
  });

  it("every counted kind, in the spec's order (customers, households or businesses, calls, conversations, files, form answers), reversed in the object literal on purpose (mutation: Object.keys(counts) order -> FAILS)", () => {
    const counts: AccessLogCounts = {
      customer_list_export: 1, form_answers: 1, file: 1, conversation: 1, call: 1, group: 1, contact: 1,
    };
    expect(visitSummary(counts, trEn)).toBe(
      "Opened 1 customer, 1 household or business, 1 call, 1 conversation, 1 file and the answers to 1 form. Downloaded your customer list.",
    );
  });

  it("a download after opened records is its OWN sentence, never merged into the list (mutation: fold it into the opened list -> FAILS)", () => {
    const counts: AccessLogCounts = { ...ZERO, contact: 2, customer_list_export: 1 };
    expect(visitSummary(counts, trEn)).toBe("Opened 2 customers. Downloaded your customer list.");
  });

  it("an export alone, more than once, carries no 'opened' sentence and no 'nothing' sentence (mutation: always prepend one of those two -> FAILS)", () => {
    const counts: AccessLogCounts = { ...ZERO, customer_list_export: 2 };
    expect(visitSummary(counts, trEn)).toBe("Downloaded your customer list 2 times.");
  });

  it("all zeroes, export included, reads as nothing opened (mutation: omit the 'nothing' sentence when every count is zero -> FAILS)", () => {
    expect(visitSummary(ZERO, trEn)).toBe("Didn't open any customer, call, conversation or file.");
    expect(visitSummary(ZERO, trEs)).toBe("No abrió ningún cliente, llamada, conversación ni archivo.");
  });
});

describe("visitSpan", () => {
  it("renders in the ACCOUNT's zone, never the machine's (mutation: render in the machine's zone -> FAILS)", () => {
    const honolulu = visitSpan("2026-10-30T08:30:00Z", "2026-10-30T08:45:00Z", "Pacific/Honolulu", "en");
    expect(honolulu).toContain("Oct 29");
    expect(honolulu).not.toContain("Oct 30");
    const chicago = visitSpan("2026-10-30T08:30:00Z", "2026-10-30T08:45:00Z", "America/Chicago", "en");
    expect(chicago).toContain("Oct 30");
    expect(chicago).not.toContain("Oct 29");
  });

  it("a visit with no end shows its start only, no dash (mutation: always render start-end -> FAILS)", () => {
    const s = visitSpan("2026-10-30T08:30:00Z", null, "America/Chicago", "en");
    expect(s).not.toContain("–");
    expect(s).toContain("3:30 AM");
  });

  it("a span crossing midnight names both days", () => {
    const s = visitSpan("2026-10-30T23:50:00-05:00", "2026-10-31T00:10:00-05:00", "America/Chicago", "en");
    expect(s).toContain("Oct 30");
    expect(s).toContain("Oct 31");
    expect(s).toContain("11:50 PM");
    expect(s).toContain("12:10 AM");
  });

  it("the repeated autumn hour carries BOTH zone names in English and in Spanish, and the end never silently reads earlier with nothing to say why (mutation: drop the offset check -> FAILS)", () => {
    const en = visitSpan("2026-11-01T06:30:00Z", "2026-11-01T07:20:00Z", "America/Chicago", "en");
    expect(en).toContain("1:30 AM CDT");
    expect(en).toContain("1:20 AM CST");
    const es = visitSpan("2026-11-01T06:30:00Z", "2026-11-01T07:20:00Z", "America/Chicago", "es");
    expect(es).toContain("CDT");
    expect(es).toContain("CST");
  });
});

// A single Honolulu visit, no items: the smallest fixture that still proves the field names line up.
const EMPTY_PAGE = (id: string): AccessLogPage => ({
  total: 1,
  hasOlder: false,
  visits: [{
    id, actorName: "Dan Lopez", reason: "support", startedAt: "2026-10-29T19:10:00Z", endedAt: null,
    counts: ZERO, itemTotal: 0, items: [],
  }],
});

const EMPTY_NAMES: AccessLogNames = {
  contacts: new Map(), groups: new Map(), calls: new Map(), conversations: new Map(), documents: new Map(), forms: new Map(),
};

describe("buildVisitRows: every item kind, its own text, href and label", () => {
  const item = (over: Partial<AccessLogItem>): AccessLogItem =>
    ({ kind: "contact", recordId: null, itemCount: null, firstOpenedAt: "2026-10-29T19:00:00Z", ...over });

  const names: AccessLogNames = {
    contacts: new Map([
      ["c_archived", { first: "Maria", last: "Lopez", archived: true }],
      ["c_caller", { first: "Ana", last: "Ruiz", archived: false }],
    ]),
    groups: new Map([
      ["g_business", { name: "Rio Roofing", kind: "business" }],
      ["g_household", { name: "The Smiths", kind: "household" }],
    ]),
    calls: new Map([["call1", { contactId: "c_caller", startedAt: "2026-10-28T20:04:00Z" }]]),
    conversations: new Map([["conv1", { contactId: "c_caller" }]]),
    documents: new Map([
      ["doc_trashed", { title: "Insurance card", trashed: true, record: { kind: "contact", id: "c_caller" } }],
      ["doc_plain", { title: "W-9", trashed: false, record: { kind: "contact", id: "c_caller" } }],
      ["doc_group", { title: "Lease", trashed: false, record: { kind: "group", id: "g_business" } }],
    ]),
    forms: new Map([["form1", { name: "Contact us" }]]),
  };

  const visitA: AccessLogVisit = {
    id: "visit_a", actorName: "Dan Lopez", reason: "support", startedAt: "2026-10-29T19:10:00Z", endedAt: "2026-10-29T19:25:00Z",
    counts: { contact: 1, group: 2, call: 1, conversation: 1, file: 3, form_answers: 1, customer_list_export: 1 },
    itemTotal: 10,
    items: [
      item({ kind: "contact", recordId: "c_archived" }),
      item({ kind: "group", recordId: "g_business" }),
      item({ kind: "group", recordId: "g_household" }),
      item({ kind: "call", recordId: "call1" }),
      item({ kind: "conversation", recordId: "conv1" }),
      item({ kind: "document_view", recordId: "doc_trashed" }),
      item({ kind: "document_download", recordId: "doc_plain" }),
      item({ kind: "document_share", recordId: "doc_group" }),
      item({ kind: "form_answers", recordId: "form1" }),
      item({ kind: "customer_list_export", recordId: null, itemCount: 212 }),
    ],
  };

  const page: AccessLogPage = { total: 1, hasOlder: false, visits: [visitA] };

  it("a call or conversation with no customer (contactId null) reads callNoName / conversationNoName and still links, in English and Spanish (mutation: always use the named key -> FAILS)", () => {
    const noName: AccessLogNames = {
      ...EMPTY_NAMES,
      calls: new Map([["call_anon", { contactId: null, startedAt: "2026-10-28T20:04:00Z" }]]),
      conversations: new Map([["conv_anon", { contactId: null }]]),
    };
    const v: AccessLogVisit = {
      ...visitA, id: "visit_anon", counts: { ...ZERO, call: 1, conversation: 1 }, itemTotal: 2,
      items: [item({ kind: "call", recordId: "call_anon" }), item({ kind: "conversation", recordId: "conv_anon" })],
    };
    const one: AccessLogPage = { total: 1, hasOlder: false, visits: [v] };
    const [en] = buildVisitRows(one, noName, { tr: trEn, zone: ZONE, base: BASE });
    expect(en!.items.map((i) => i.text)).toEqual(["Call · Oct 28, 2026, 3:04 PM", "Conversation"]);
    expect(en!.items.map((i) => i.href)).toEqual([`${BASE}/calls/call_anon`, `${BASE}/conversations?c=conv_anon`]);
    const [es] = buildVisitRows(one, noName, { tr: trEs, zone: ZONE, base: BASE });
    expect(es!.items.map((i) => i.text)[0]).toMatch(/^Llamada · /);
    expect(es!.items.map((i) => i.text)[1]).toBe("Conversación");
  });

  it("each item's text and href come from its own kind, the gone/trashed/archived suffixes apply, and a group's label follows ITS OWN kind (mutations: drop the archived suffix -> FAILS; ignore kind for a group -> FAILS)", () => {
    const [row] = buildVisitRows(page, names, { tr: trEn, zone: ZONE, base: BASE });
    expect(row!.label).toBe("Dan Lopez · Support request");
    expect(row!.more).toBeNull();
    expect(row!.items.map((i) => i.text)).toEqual([
      "Customer · Maria Lopez (archived)",
      "Business · Rio Roofing",
      "Household · The Smiths",
      "Call · Ana Ruiz · Oct 28, 2026, 3:04 PM",
      "Conversation · Ana Ruiz",
      "File · Insurance card (in the trash) · viewed",
      "File · W-9 · downloaded",
      "File · Lease · shared",
      "Form answers · Contact us",
      "Downloaded your customer list (212 customers)",
    ]);
    expect(row!.items.map((i) => i.href)).toEqual([
      `${BASE}/contacts/c_archived`,
      `${BASE}/groups/g_business`,
      `${BASE}/groups/g_household`,
      `${BASE}/calls/call1`,
      `${BASE}/conversations?c=conv1`,
      `${BASE}/contacts/c_caller?document=doc_trashed`,
      `${BASE}/contacts/c_caller?document=doc_plain`,
      `${BASE}/groups/g_business?document=doc_group`,
      `${BASE}/forms/form1`,
      null,
    ]);
  });

  it("the same items in Spanish: the kind words, the archived/trashed suffixes and the export sentence all carry the Spanish twin", () => {
    const [row] = buildVisitRows(page, names, { tr: trEs, zone: ZONE, base: BASE });
    const texts = row!.items.map((i) => i.text);
    expect(texts[0]).toBe("Cliente · Maria Lopez (archivado)");
    expect(texts[1]).toBe("Negocio · Rio Roofing");
    expect(texts[2]).toBe("Hogar · The Smiths");
    expect(texts[3]).toContain("Llamada · Ana Ruiz");
    expect(texts[4]).toBe("Conversación · Ana Ruiz");
    expect(texts[5]).toBe("Archivo · Insurance card (en la papelera) · visto");
    expect(texts[6]).toBe("Archivo · W-9 · descargado");
    expect(texts[7]).toBe("Archivo · Lease · compartido");
    expect(texts[8]).toBe("Respuestas del formulario · Contact us");
    expect(texts[9]).toBe("Descargó su lista de clientes (212 clientes)");
  });

  it("a missing record of every closed kind is never a link, and the actor falls back to 'Someone at BIS' / 'Alguien de BIS' (mutation: link a gone record -> FAILS)", () => {
    const visitB: AccessLogVisit = {
      id: "visit_b", actorName: null, reason: "fix", startedAt: "2026-10-28T15:00:00Z", endedAt: "2026-10-28T15:05:00Z",
      counts: { ...ZERO, contact: 1, group: 1, file: 1, call: 1, conversation: 1, form_answers: 1 },
      itemTotal: 6,
      items: [
        item({ kind: "contact", recordId: "c_gone" }),
        item({ kind: "group", recordId: "g_gone" }),
        item({ kind: "document_download", recordId: "doc_gone" }),
        item({ kind: "call", recordId: "call_gone" }),
        item({ kind: "conversation", recordId: "conv_gone" }),
        item({ kind: "form_answers", recordId: "form_gone" }),
      ],
    };
    const pageB: AccessLogPage = { total: 1, hasOlder: false, visits: [visitB] };
    const [rowEn] = buildVisitRows(pageB, EMPTY_NAMES, { tr: trEn, zone: ZONE, base: BASE });
    expect(rowEn!.label).toBe("Someone at BIS · Fixing a problem");
    expect(rowEn!.items).toEqual([
      { key: "contact-c_gone", text: "A customer who was later deleted", href: null },
      { key: "group-g_gone", text: "A household or business that was later deleted", href: null },
      { key: "document_download-doc_gone", text: "A file that was later deleted for good", href: null },
      { key: "call-call_gone", text: "A record that was later deleted", href: null },
      { key: "conversation-conv_gone", text: "A record that was later deleted", href: null },
      { key: "form_answers-form_gone", text: "A record that was later deleted", href: null },
    ]);
    expect(rowEn!.more).toBeNull();
    const [rowEs] = buildVisitRows(pageB, EMPTY_NAMES, { tr: trEs, zone: ZONE, base: BASE });
    expect(rowEs!.label).toBe("Alguien de BIS · Arreglar un problema");
  });

  it("'more' names the remainder exactly, and is null once every item is shown (mutation: drop the +1 math or always show it -> FAILS)", () => {
    const manyItems: AccessLogItem[] = Array.from({ length: 100 }, (_, i) =>
      item({ kind: "customer_list_export", recordId: null, itemCount: 1, firstOpenedAt: `2026-10-29T19:${String(i).padStart(2, "0")}:00Z` }));
    const visitC: AccessLogVisit = {
      id: "visit_c", actorName: "Dan Lopez", reason: "setup", startedAt: "2026-10-29T19:00:00Z", endedAt: "2026-10-29T19:59:00Z",
      counts: { ...ZERO, customer_list_export: 137 }, itemTotal: 137, items: manyItems,
    };
    const pageC: AccessLogPage = { total: 1, hasOlder: false, visits: [visitC] };
    const [rowEn] = buildVisitRows(pageC, EMPTY_NAMES, { tr: trEn, zone: ZONE, base: BASE });
    expect(rowEn!.more).toBe("and 37 more");
    const [rowEs] = buildVisitRows(pageC, EMPTY_NAMES, { tr: trEs, zone: ZONE, base: BASE });
    expect(rowEs!.more).toBe("y 37 más");
  });

  it("an empty visit still carries its own label, when and summary (no items, nothing to show)", () => {
    const [row] = buildVisitRows(EMPTY_PAGE("visit_empty"), EMPTY_NAMES, { tr: trEn, zone: "Pacific/Honolulu", base: BASE });
    expect(row!.id).toBe("visit_empty");
    expect(row!.items).toEqual([]);
    expect(row!.more).toBeNull();
    expect(row!.summary).toBe("Didn't open any customer, call, conversation or file.");
  });
});

describe("access cursor: round-trips, garbage and undefined read as no cursor", () => {
  it("encode then parse returns the same startedAt and id", () => {
    const visit: AccessLogVisit = {
      id: "11111111-1111-1111-1111-111111111111", actorName: "Dan Lopez", reason: "billing",
      startedAt: "2026-10-29T19:10:00.123456Z", endedAt: null, counts: ZERO, itemTotal: 0, items: [],
    };
    const encoded = encodeAccessCursor(visit);
    expect(parseAccessCursor(encoded)).toEqual({ startedAt: visit.startedAt, id: visit.id });
  });

  it("garbage and undefined both read as no cursor, never a thrown error", () => {
    expect(parseAccessCursor("not-a-real-cursor")).toBeNull();
    expect(parseAccessCursor(undefined)).toBeNull();
  });

  it("a hand-crafted cursor whose v is itself null is invalid, never passed through (mutation: accept a null v as a valid cursor -> FAILS)", () => {
    const nullV = encodeCursor({ v: null, id: "11111111-1111-1111-1111-111111111111" });
    expect(parseAccessCursor(nullV)).toBeNull();
  });

  it("a hand-crafted cursor whose v is not a timestamp reads as page one (mutation: drop the Date.parse check -> FAILS)", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(parseAccessCursor(encodeCursor({ v: "garbage", id }))).toBeNull();
    expect(parseAccessCursor(encodeCursor({ v: "", id }))).toBeNull();
    expect(parseAccessCursor(encodeCursor({ v: "2026-10-29T19:10:00Z", id }))).toEqual({ startedAt: "2026-10-29T19:10:00Z", id });
  });
});
