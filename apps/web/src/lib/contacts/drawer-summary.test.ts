import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { parseDrawerSummary, drawerLoadFrom, drawerSummaryUrl, drawerFieldsRow, type DrawerSummary } from "./drawer-summary";

const ROW = { key: "booking-b1", kind: "booking", mark: { kind: "customer", label: "Customer" }, verb: "booked an appointment for Fri, Oct 16, 10:00 AM",
  status: { tone: "accent", word: "Booked" }, detail: null, time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z",
  excerpt: { text: "Gate code 4411", lang: "", done: false } } as const;
const GOOD: DrawerSummary = {
  locale: "en",
  header: { name: "Maria Garcia", subtitle: "García household", subtitleHref: "/dashboard/accounts/a1/groups/g1", archivedAt: null, actions: [
    { id: "call", label: "Call", href: "tel:+19565550100", ariaLabel: "Call Maria Garcia", primary: true, external: false },
    { id: "email", label: "Email", href: "/dashboard/accounts/a1/contacts/c1#compose-email", primary: false, external: false },
  ] },
  facts: { status: "ready", view: { line: ["Customer since Dec 2025"], missing: null, allFailed: false } },
  nextUp: { status: "ready", view: { rows: [{ kind: "booking", id: "b1", label: "Fri, Oct 16 · 10:00 AM", who: null }], undated: null }, emptyText: "Nothing coming up." },
  recent: { status: "ready", rows: [{ ...ROW, mark: { ...ROW.mark }, status: { ...ROW.status }, excerpt: { ...ROW.excerpt } }], failedText: null, emptyText: null,
    seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline" },
  who: { source: "voice", sourceHint: "They called in", assignedTo: null,
    fields: { first_name: "Maria", last_name: "Garcia", email: "maria@example.com", phone: "+19565550100", company_name: null },
    tags: { status: "ready", tags: [{ id: "t1", name: "vip" }] },
    language: { value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null } },
};
const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(GOOD));

describe("parseDrawerSummary (S-03 part 3 §7.4): checked, not cast, one section at a time", () => {
  // Contact archive, final review M2: a `?peek=` stub has no list row to say it is archived, so the body does.
  it("the header carries archivedAt through; an older body without it reads not archived; a non-string is a malformed header (mutation: drop archivedAt from parseHeader -> FAILS)", () => {
    const archived = clone();
    (archived.header as Record<string, unknown>).archivedAt = "2026-10-20T15:00:00Z";
    expect(parseDrawerSummary(archived)!.header.archivedAt).toBe("2026-10-20T15:00:00Z");
    const older = clone();
    delete (older.header as Record<string, unknown>).archivedAt;
    expect(parseDrawerSummary(older)!.header.archivedAt).toBeNull();
    const bad = clone();
    (bad.header as Record<string, unknown>).archivedAt = 42;
    expect(parseDrawerSummary(bad)).toBeNull();
  });

  it("a good body parses to itself, ready everywhere (mutation: drop a field from any section's parse -> FAILS)", () => {
    expect(parseDrawerSummary(clone())).toEqual({ ...GOOD, who: { status: "ready", ...GOOD.who } });
  });

  it("a malformed Recent costs Recent alone, with its own words (mutation: return null for the whole body on any bad section -> FAILS)", () => {
    const body = clone();
    body.recent = { status: "ready", rows: "not rows" };
    const parsed = parseDrawerSummary(body)!;
    expect(parsed.recent).toEqual({ status: "error", text: m["record.card.failed"].replace("{title}", m["drawer.recent"]) });
    expect([parsed.facts.status, parsed.nextUp.status, parsed.who.status]).toEqual(["ready", "ready", "ready"]);
  });

  it("each section's fallback is in the body's own language (mutation: read the fallback in English -> FAILS)", () => {
    const body = clone();
    body.locale = "es";
    body.nextUp = 42;
    expect(parseDrawerSummary(body)!.nextUp).toEqual({ status: "error", text: m["record.card.failed.es"].replace("{title}", m["record.card.nextUp.es"]) });
  });

  it("a server's own error section passes through with its words, not the parser's own fallback (mutation: drop the pass-through in section() -> FAILS)", () => {
    const body = clone();
    // Deliberately distinct from every parser fallback (record.card.failed, record.summary.failed,
    // etc.): a test that reused one of those words could pass even if the parser discarded the
    // server's own text and substituted its own fallback instead.
    body.facts = { status: "error", text: "Scheduled maintenance until 9am; try again after." };
    expect(parseDrawerSummary(body)!.facts).toEqual({ status: "error", text: "Scheduled maintenance until 9am; try again after." });
  });

  it("no header, or no known locale, is the whole drawer's error: nothing to title it with (mutation: default the header -> FAILS)", () => {
    const noHeader = clone(); delete noHeader.header;
    expect(parseDrawerSummary(noHeader)).toBeNull();
    const badLocale = clone(); badLocale.locale = "fr";
    expect(parseDrawerSummary(badLocale)).toBeNull();
    expect(parseDrawerSummary("<html>")).toBeNull();
  });

  it("an action whose href is not tel:, a path, an anchor or https is refused (mutation: accept any string -> FAILS)", () => {
    const body = clone();
    (body.header as { actions: { href: string }[] }).actions[0]!.href = "javascript:alert(1)";
    expect(parseDrawerSummary(body)).toBeNull();
  });

  it("a protocol-relative href (//evil.example, which a browser reads as https://evil.example) is refused, never mistaken for a path (mutation: safeHref's old /^(tel:|\\/|#|https:\\/\\/)/ -> FAILS)", () => {
    const body = clone();
    (body.header as { actions: { href: string }[] }).actions[0]!.href = "//evil.example";
    expect(parseDrawerSummary(body)).toBeNull();
  });

  it("a backslash-slash href (/\\evil.example, which a browser resolves to https://evil.example) is refused, never mistaken for a path (mutation: safeHref's old /^(tel:|\\/(?!\\/)|#|https:\\/\\/)/ -> FAILS)", () => {
    const body = clone();
    (body.header as { actions: { href: string }[] }).actions[0]!.href = "/\\evil.example";
    expect(parseDrawerSummary(body)).toBeNull();
  });

  it("a recent row of a kind this bundle does not know is dropped and the rest stay (mutation: refuse the section -> FAILS)", () => {
    const body = clone();
    (body.recent as { rows: unknown[] }).rows.unshift({ ...ROW, key: "visit-v1", kind: "visit" });
    expect(parseDrawerSummary(body)!.recent).toEqual(GOOD.recent);
  });

  it("a document row (S-07) parses and is kept, never dropped as an unknown kind (mutation: drop document from ROW_KINDS -> the row is dropped, FAILS)", () => {
    const body = clone();
    const doc = { key: "document-d1", kind: "document", mark: { kind: "person", label: "Ana" }, verb: "added a file: Signed lease",
      status: { tone: "muted", word: "In the trash" }, detail: "Contract", time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    (body.recent as { rows: unknown[] }).rows = [doc];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [doc], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("a new-version row (S-07 1b) parses and is kept, never dropped as an unknown kind (mutation: drop documentVersion from ROW_KINDS -> FAILS)", () => {
    const body = clone();
    const ver = { key: "documentVersion-v2", kind: "documentVersion", mark: { kind: "person", label: "Ana" }, verb: "uploaded a new version of Signed lease",
      status: null, detail: "Contract", time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    (body.recent as { rows: unknown[] }).rows = [ver];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [ver], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("a removed-file row (S-07 2a) parses and is kept (mutation: drop documentRemoved from ROW_KINDS -> FAILS)", () => {
    const body = clone();
    const removed = { key: "documentRemoved-v9", kind: "documentRemoved", mark: { kind: "automation", label: "Automation" }, verb: "removed Lease: it had a virus",
      status: { tone: "crit", word: "Removed: it had a virus" }, detail: "Contract", time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    (body.recent as { rows: unknown[] }).rows = [removed];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [removed], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("a document-request row (S-07 2b) parses and is kept (mutation: drop documentRequest from ROW_KINDS -> FAILS)", () => {
    const body = clone();
    const req = { key: "documentRequest-r1", kind: "documentRequest", mark: { kind: "person", label: "Ana" }, verb: "asked for 2 documents",
      status: null, detail: "Insurance, Pool permit", time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    (body.recent as { rows: unknown[] }).rows = [req];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [req], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("a skip and an un-skip row (S-07 2c) each parse and are kept (mutation: drop documentSkip or documentUnskip from ROW_KINDS -> FAILS)", () => {
    const body = clone();
    const skip = { key: "documentSkip-k1", kind: "documentSkip", mark: { kind: "person", label: "Ana" }, verb: "marked Insurance as not needed",
      status: null, detail: null, time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    const unskip = { ...skip, key: "documentUnskip-k1", kind: "documentUnskip", verb: "marked Insurance as needed again", dateTime: "2026-10-09T17:12:00Z" };
    (body.recent as { rows: unknown[] }).rows = [unskip, skip];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [unskip, skip], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("a share and its first open row (S-07 3b) each parse and are kept (mutation: drop documentShared or documentShareOpened from ROW_KINDS -> FAILS)", () => {
    const body = clone();
    const shared = { key: "documentShared-s1", kind: "documentShared", mark: { kind: "person", label: "Ana" }, verb: "shared Seguro 2026.pdf",
      status: null, detail: "Insurance", time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    const opened = { ...shared, key: "documentShareOpened-s1", kind: "documentShareOpened", mark: { kind: "customer", label: "The link's recipient" },
      verb: "opened Seguro 2026.pdf", dateTime: "2026-10-09T17:12:00Z" };
    (body.recent as { rows: unknown[] }).rows = [opened, shared];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [opened, shared], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("a merge row and a mergeUndone row (F-006 part 1, plan Task 9 review carry-in) parse and are kept, never dropped as an unknown kind (mutation: drop merge or mergeUndone from ROW_KINDS -> FAILS)", () => {
    const body = clone();
    const merged = { key: "merge-1", kind: "merge", mark: { kind: "person", label: "Ana" }, verb: "merged Other Person into this record: 1 note moved here",
      status: null, detail: null, time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    const undone = { ...merged, key: "merge-2", kind: "mergeUndone", verb: "undid the merge with Other Person", dateTime: "2026-10-09T17:12:00Z" };
    (body.recent as { rows: unknown[] }).rows = [undone, merged];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [undone, merged], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("a website chat row (S-06 part 3) parses and is kept, its unconfirmed line with it (mutation: drop chat from ROW_KINDS -> the row is dropped, FAILS)", () => {
    const body = clone();
    const chat = { key: "chat-m0", kind: "chat", mark: { kind: "customer", label: "Customer" }, verb: "chatted with Sofía on your website",
      status: null, detail: "12 messages", time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z",
      excerpt: { text: "Matched by the phone or email they typed; not confirmed.", lang: "en", done: false } };
    (body.recent as { rows: unknown[] }).rows = [chat];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [chat], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("a recent row whose excerpt carries the contact's language ('es') parses (mutation: keep lang === \"\" || lang === \"en\" -> the row is malformed -> FAILS)", () => {
    const body = clone();
    (body.recent as { rows: unknown[] }).rows = [{ ...ROW, excerpt: { text: "Hola", lang: "es", done: false } }];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [{ ...ROW, excerpt: { text: "Hola", lang: "es", done: false } }],
      failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });

  it("who: a missing holder leaves Assigned to out (undefined), never Unassigned; a bad tags list costs Tags alone", () => {
    const body = clone();
    delete (body.who as Record<string, unknown>).assignedTo;
    (body.who as Record<string, unknown>).tags = { status: "ready", tags: [{ id: 1 }] };
    const who = parseDrawerSummary(body)!.who;
    expect(who).toMatchObject({ status: "ready", assignedTo: undefined, tags: { status: "error" }, source: "voice" });
  });
});

describe("who.language (S-09 §8.1, plan deviation 11)", () => {
  const VIEW = { value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null };
  const body = (language: unknown) => ({ ...JSON.parse(JSON.stringify(GOOD)), who: { ...GOOD.who, language } });
  it("a good view passes through", () => {
    const p = parseDrawerSummary(body(VIEW))!;
    expect(p.who).toMatchObject({ status: "ready", language: VIEW });
  });
  it("absent: the line is left out, the section still ready (mutation: treat absent as malformed -> FAILS)", () => {
    const b = body(VIEW);
    delete (b.who as Record<string, unknown>).language;
    expect(parseDrawerSummary(b)!.who).toMatchObject({ status: "ready", language: undefined });
  });
  it("malformed: the who section's error, never the drawer's (mutation: drop the language !== null test -> FAILS)", () => {
    const p = parseDrawerSummary(body({ ...VIEW, value: "fr" }))!;
    expect(p).not.toBeNull();
    expect(p.who.status).toBe("error");
  });
});

describe("contactId and duplicates (F-006 part 1, plan Task 11): a merged-away record's deep link opens the KEPT record's drawer", () => {
  const PAIR = { id: "pr1", a: { id: "c1", firstName: "Maria", lastName: "Garcia" }, b: { id: "c9", firstName: "Jose", lastName: "Garcia" }, reason: "same_phone", strength: 1, createdAt: "2026-10-09T16:12:00Z" };

  it("both pass through a good body (mutation: drop either from the parse -> FAILS)", () => {
    const body = { ...clone(), contactId: "k1", duplicates: [PAIR] };
    const p = parseDrawerSummary(body)!;
    expect(p.contactId).toBe("k1");
    expect(p.duplicates).toEqual([PAIR]);
  });

  it("absent (an older server): both read undefined, never a malformed-whole-drawer and never a guessed id (mutation: default contactId to the fetched id -> FAILS)", () => {
    const body = clone();
    expect(parseDrawerSummary(body)!.contactId).toBeUndefined();
    expect(parseDrawerSummary(body)!.duplicates).toBeUndefined();
  });

  it("a malformed contactId is dropped (treated as absent), never the whole drawer's error (mutation: fail the body -> FAILS)", () => {
    const body = { ...clone(), contactId: 42 };
    const p = parseDrawerSummary(body);
    expect(p).not.toBeNull();
    expect(p!.contactId).toBeUndefined();
  });

  it("a malformed pair is dropped; the pairs around it still parse (mutation: drop the whole list on one bad pair -> FAILS)", () => {
    const bad = { ...PAIR, id: 42 };
    const body = { ...clone(), duplicates: [PAIR, bad] };
    expect(parseDrawerSummary(body)!.duplicates).toEqual([PAIR]);
  });

  it("duplicates that is not an array at all reads as none, never the whole drawer's error (mutation: fail the body -> FAILS)", () => {
    const body = { ...clone(), duplicates: "not an array" };
    const p = parseDrawerSummary(body);
    expect(p).not.toBeNull();
    expect(p!.duplicates).toEqual([]);
  });
});

describe("drawerLoadFrom, drawerSummaryUrl, drawerFieldsRow", () => {
  it("a non-OK answer is the error and its body is never read (mutation: parse first -> FAILS)", async () => {
    const json = vi.fn(async () => GOOD);
    expect(await drawerLoadFrom({ ok: false, json })).toEqual({ status: "error" });
    expect(json).not.toHaveBeenCalled();
    expect(await drawerLoadFrom({ ok: true, json })).toMatchObject({ status: "ready", body: { locale: "en" } });
  });

  it("the QA locale rides along only when the list URL has one (C9; mutation: always append -> the bare-path case FAILS)", () => {
    expect(drawerSummaryUrl("a1", "c1", "")).toBe("/api/accounts/a1/contacts/c1/summary");
    expect(drawerSummaryUrl("a1", "c1", "?q=Retry&peek=c1")).toBe("/api/accounts/a1/contacts/c1/summary");
    expect(drawerSummaryUrl("a1", "c1", "?q=x&locale=pseudo")).toBe("/api/accounts/a1/contacts/c1/summary?locale=pseudo");
    expect(drawerSummaryUrl("a1", "c1", "?locale=%3Cscript%3E")).toBe("/api/accounts/a1/contacts/c1/summary");
  });

  it("Q1: a real row feeds the fields; a ?peek= stub waits for the route's (mutation: show the stub's blanks -> FAILS)", () => {
    const real = { id: "c1", first_name: "Ana", last_name: null, email: null, phone: null, company_name: null, created_at: "2026-09-01T00:00:00Z" };
    const stub = { ...real, first_name: null, created_at: "" };
    expect(drawerFieldsRow(real, { status: "loading" })).toBe(real);
    expect(drawerFieldsRow(stub, { status: "loading" })).toBeNull();
    const ready = { status: "ready" as const, body: parseDrawerSummary(clone())! };
    expect(drawerFieldsRow(stub, ready)).toEqual({ ...stub, ...GOOD.who.fields });
  });
});
