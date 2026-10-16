import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// M1: records what the timeline card hands RecordCardRetry, so "Try again" with no onRetry (a plain
// card refresh, which review judged right) is pinned, not just its label text.
const retryProps: Record<string, unknown>[] = [];
vi.mock("@/components/record/record-card", () => ({
  RecordCardRetry: (p: Record<string, unknown>) => {
    retryProps.push(p);
    return createElement("button", { type: "button" }, p.label as string);
  },
}));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");
const { m } = await import("@/lib/messages");

const AT = "2026-10-09T16:12:00Z";
const ENTRIES: TimelineEntry[] = [
  // Production-shaped (summarize.ts's composeSummary): the system's own fact line first, a blank
  // line, then the model's prose — never just prose on its own (minors-1b item 5).
  { kind: "call", id: "k1", at: AT, contactId: "c1", call: { id: "k1", contact_id: "c1", started_at: AT, outcome: "booked", duration_secs: 180, reason: null,
    summary: "RECORDED — Booked: Dan Lopez at 2026-08-31T14:00:00.000Z · Intake: nothing captured.\n\nCaller wants a quote for a roof leak.",
    language: "es" } },
  { kind: "booking", id: "b1", at: AT, contactId: "c1", booking: { id: "b1", contact_id: "c1", created_at: AT, starts_at: "2026-10-16T15:00:00Z", status: "booked", note: null,
    author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } },
  { kind: "message", id: "m1", at: AT, contactId: "c1", message: { id: "m1", channel: "email", direction: "outbound", status: "delivered", subject: "Quote",
    body: "Here it is", error: null, created_at: AT, author_kind: "person", author_id: "user_dan" } },
  { kind: "deal", id: "d1", at: AT, contactId: "c1", deal: { id: "d1", name: "Deck build", status: "open", monetary_value: 2400, created_at: AT, created_by: null } },
  { kind: "note", id: "n1", at: AT, contactId: "c1", note: { id: "n1", body: "Gate code 4411", author_id: "user_me", created_at: AT } },
];
const render = (over: Record<string, unknown> = {}, locale: "en" | "es" = "en") => {
  const tr = makeTr(locale);
  const rows = timelineRows(ENTRIES, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: { user_dan: "Dan López" }, personaName: null, tr } });
  const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale, emailAction: async () => {}, smsAction: async () => {} });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null, ...over } as never));
};

describe("the 1b timeline (spec §6, §9.4)", () => {
  it("every row carries an author mark: a row with no mark is a defect (DESIGN.md Provenance; mutation: render the deal row without its mark -> FAILS)", () => {
    const html = render();
    const items = html.match(/data-timeline-item="/g) ?? [];
    expect(items).toHaveLength(ENTRIES.length);
    expect(html.match(/data-author-mark="/g)).toHaveLength(ENTRIES.length);
    for (const label of ["Sofía · AI", "Customer", "Dan López", "Someone on the team", "You"]) expect(html).toContain(`>${label}<`);
  });
  it("a call row links to its call page; its English summary is lang=\"en\", its reason is lang=\"\" (unknown) — never the caller's own language (C11; mutation: lang={e.call.language} on the call's words -> FAILS)", () => {
    const html = render();
    expect(html).toContain('href="/dashboard/accounts/a1/calls/k1"');
    // calls.summary is always English (owner decision A), even on a Spanish-language call. Only the
    // model's PROSE renders here — never the system's own fact line or its ISO timestamp (minors-1b
    // item 5; mutation: render e.call.summary raw -> "RECORDED" and the ISO stamp leak in, FAILS).
    expect(html).toMatch(/<p lang="en"[^>]*>Caller wants a quote for a roof leak\.<\/p>/);
    expect(html).not.toContain("RECORDED");
    expect(html).not.toContain("2026-08-31T14:00:00.000Z");
    expect(html).toMatch(/<p lang=""[^>]*>Gate code 4411<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>Here it is<\/p>/);

    // calls.reason (a taken-message body, or an English post-call reading) is of unknown
    // language here — not the caller's own words (calls.caller_words, shown on the call card).
    const reasonEntries: TimelineEntry[] = [
      { kind: "call", id: "k2", at: AT, contactId: "c1", call: { id: "k2", contact_id: "c1", started_at: AT, outcome: "message", duration_secs: 60, reason: "Se le gotea el techo", summary: "", language: "es" } },
    ];
    const tr = makeTr("en");
    const rows = timelineRows(reasonEntries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "en", emailAction: async () => {}, smsAction: async () => {} });
    const reasonHtml = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    expect(reasonHtml).toMatch(/<p lang=""[^>]*>Se le gotea el techo<\/p>/);
  });
  it("a summary with a ⚠ MISMATCH block shows no summary text at all — the prose is contradicted by the recorded state, and the row still has its verb, status and Open-call link (minors-1b item 5; mutation: render the prose anyway -> FAILS)", () => {
    const mismatchEntries: TimelineEntry[] = [
      { kind: "call", id: "k3", at: AT, contactId: "c1", call: {
        id: "k3", contact_id: "c1", started_at: AT, outcome: "booked", duration_secs: 60, reason: null,
        summary: "RECORDED — Booked: no appointment was recorded · Intake: nothing captured.\n\n"
          + "⚠ MISMATCH — the notes below mention an appointment, which the system did not record. "
          + "The caller may have been told otherwise on the call. Check before following up.\n\n"
          + "I booked an appointment for Thursday.",
        language: "en",
      } },
    ];
    const tr = makeTr("en");
    const rows = timelineRows(mismatchEntries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "en", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    expect(html).not.toContain("RECORDED");
    expect(html).not.toContain("MISMATCH");
    expect(html).not.toContain("I booked an appointment for Thursday.");
    // The row itself still renders — Open call link, no summary paragraph.
    expect(html).toContain('href="/dashboard/accounts/a1/calls/k3"');
    expect(html).not.toContain("line-clamp-2");
  });
  it("a PROSE-ONLY summary (no fact line at all — 34 of 271 production calls, the Resaca demo account among them) renders on the row (review fix; mutation: classify the lone block as facts by position -> FAILS)", () => {
    const proseOnlyEntries: TimelineEntry[] = [
      { kind: "call", id: "k4", at: AT, contactId: "c1", call: {
        id: "k4", contact_id: "c1", started_at: AT, outcome: "message", duration_secs: 45, reason: null,
        summary: "Wants a replacement quote — 18-year-old system, says it's making noise.",
        language: "en",
      } },
    ];
    const tr = makeTr("en");
    const rows = timelineRows(proseOnlyEntries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "en", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    // React escapes the apostrophe to &#x27; in static markup.
    expect(html).toMatch(/<p lang="en"[^>]*>Wants a replacement quote — 18-year-old system, says it&#x27;s making noise\.<\/p>/);
  });
  it("a FACT-LINE-ONLY summary (nothing to show the customer) renders no summary text, but the row keeps its verb, status and Open-call link (mutation: fall back to the raw summary -> FAILS)", () => {
    const factsOnlyEntries: TimelineEntry[] = [
      { kind: "call", id: "k5", at: AT, contactId: "c1", call: {
        id: "k5", contact_id: "c1", started_at: AT, outcome: "booked", duration_secs: 30, reason: null,
        summary: "RECORDED — Booked: no appointment was recorded · Intake: nothing captured.",
        language: "en",
      } },
    ];
    const tr = makeTr("en");
    const rows = timelineRows(factsOnlyEntries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "en", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    expect(html).not.toContain("RECORDED");
    expect(html).not.toContain("line-clamp-2");
    expect(html).toContain('href="/dashboard/accounts/a1/calls/k5"');
    expect(html).toContain(">Booked<");
  });
  it("one pager at the foot, Older and Newer as given, labelled; none when there is nowhere to go (mutation: always render the pager -> FAILS)", () => {
    const html = render({ pager: { olderHref: "/x?before=abc#record-timeline", newerHref: "/x#record-timeline" } });
    expect(html.match(/data-timeline-pager/g)).toHaveLength(1);
    expect(html).toMatch(/<nav aria-label="Pages"/);
    expect(html).toContain('href="/x?before=abc#record-timeline"');
    expect(html.indexOf(">Newer<")).toBeLessThan(html.indexOf(">Older<"));
    expect(html.lastIndexOf("data-timeline-item")).toBeLessThan(html.indexOf("data-timeline-pager"));
    expect(render()).not.toContain("data-timeline-pager");
  });
  it("some sources failed: the rows that loaded, and above them what could not be (spec §9.4; mutation: drop the notice -> FAILS)", () => {
    const html = render({ failedText: "Couldn't load calls and bookings." });
    expect(html).toMatch(/role="alert"[^>]*data-timeline-failed|data-timeline-failed[^>]*role="alert"/);
    expect(html).toContain("Couldn&#x27;t load calls and bookings.");
    expect(html.indexOf("data-timeline-failed")).toBeLessThan(html.indexOf("data-timeline-item"));
  });
  it("the failure notice's Try again renders RecordCardRetry with NO onRetry — a plain card refresh, which review judged right — and only when something failed (M1; mutation: pass onRetry={() => {}} in activity-timeline.tsx -> FAILS)", () => {
    retryProps.length = 0;
    const notice = render({ failedText: "Couldn't load calls." }).match(/<div[^>]*data-timeline-failed[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(notice).toContain(">Try again<");
    expect(retryProps).toHaveLength(1);
    expect(Object.hasOwn(retryProps[0]!, "onRetry")).toBe(false);
    expect(render()).not.toContain(">Try again<");
  });
  it("the empty state sells the timeline, only when told to (rule 5)", () => {
    const empty = render({ rows: [], emptyText: "Texts, calls, bookings, notes and To-dos with this customer show up here." });
    expect(empty).toContain("Texts, calls, bookings, notes and To-dos with this customer show up here.");
    expect(render()).not.toContain("show up here");
  });
  it("in Spanish the chrome and rows read Spanish (mutation: leave the To-do form on m[...] -> FAILS)", () => {
    const html = render({}, "es");
    for (const s of [">Agregar<", ">Cliente<", ">Usted<", "contestó una llamada", "Nuevo pendiente…"]) expect(html).toContain(s);
  });
  it("phone tap targets: the add-To-do title and due-date fields, its Add button and a row's Done button are each at least 44px tall on a phone (DESIGN DoD; mutation: drop min-h-11 from the title field -> FAILS)", () => {
    const html = render();
    const titleField = html.match(/<input[^>]*id="record-add-todo"[^>]*>/)?.[0] ?? "";
    const dueField = html.match(/<input[^>]*name="dueAt"[^>]*>/)?.[0] ?? "";
    const addButton = html.match(/<button[^>]*>Add<\/button>/)?.[0] ?? "";
    for (const el of [titleField, dueField, addButton]) {
      expect(el).toContain("min-h-11");
      expect(el).toContain("md:min-h-8");
    }

    const taskEntries = [{ kind: "task", id: "t1", at: AT, contactId: "c1", task: {
      id: "t1", title: "Follow up", due_at: null, completed_at: null, created_at: AT,
      consent_event_id: null, call_id: null, assigned_to: null, created_by: null,
    } }] as unknown as TimelineEntry[];
    const tr = makeTr("en");
    const taskRows = timelineRows(taskEntries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "en", emailAction: async () => {}, smsAction: async () => {} });
    const taskHtml = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows: taskRows, emptyText: null } as never));
    const doneButton = taskHtml.match(/<button[^>]*>done<\/button>/)?.[0] ?? "";
    expect(doneButton).toContain("min-h-11");
    expect(doneButton).toContain("md:min-h-8");
  });
  it("a document row renders as one: its verb, and a trashed file's dot and word (S-07, rule 3; mutation: return null for the document case -> FAILS)", () => {
    const docEntries: TimelineEntry[] = [{ kind: "document", id: "d1", at: AT, contactId: "c1", document: { id: "d1", title: "Signed lease", category: "contract", source: "upload",
      created_by: "user_me", created_at: AT, deleted_at: "2026-10-10T00:00:00Z", contact_id: "c1", client_group_id: null } }];
    const tr = makeTr("es");
    const rows = timelineRows(docEntries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "es", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    const row = html.match(/<div data-timeline-item="document"[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(row).toContain(`>${m["timeline.document.es"].replace("{title}", "Signed lease")}<`);
    expect(row).toMatch(new RegExp(`data-timeline-status="muted"[^>]*><span aria-hidden="true"[^>]*></span><span>${m["documents.status.trashed.es"]}</span>`));
    expect(row).toContain(`>${m["provenance.you.es"]}<`);
  });
  it("a new-version row renders as one: its verb and the uploader's mark (S-07 1b, owner ruling R2; mutation: return null for the documentVersion case -> FAILS)", () => {
    const verEntries: TimelineEntry[] = [{ kind: "documentVersion", id: "v2", at: AT, contactId: "c1", version: { id: "v2", document_id: "d1", title: "Signed lease", category: "contract",
      uploaded_by: "user_me", created_at: AT, deleted_at: null, contact_id: "c1", client_group_id: null } }];
    const tr = makeTr("es");
    const rows = timelineRows(verEntries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "es", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    const row = html.match(/<div data-timeline-item="documentVersion"[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(row).toContain(`>${m["timeline.documentVersion.es"].replace("{title}", "Signed lease")}<`);
    expect(row).toContain(`>${m["provenance.you.es"]}<`);
  });

  it("a removed-file row renders as one: its verb, the automation mark and the crit word (S-07 2a; mutation: return null for the documentRemoved case -> FAILS)", () => {
    const entries: TimelineEntry[] = [{ kind: "documentRemoved", id: "v9", at: AT, contactId: "c1", scan: { id: "v9", document_id: "d1",
      scan_status: "infected", scan_signature: null, scanned_at: AT, title: "Lease", category: "contract", deleted_at: null, contact_id: "c1", client_group_id: null } }];
    const tr = makeTr("es");
    const rows = timelineRows(entries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "es", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    const row = html.match(/<div data-timeline-item="documentRemoved"[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(row).toContain(`>${m["timeline.documentRemoved.es"].replace("{title}", "Lease")}<`);
    expect(row).toContain(`>${m["provenance.automation.es"]}<`);
    expect(row).toContain(`>${m["documents.status.virusRemoved.es"]}<`);
  });
});

describe("a document-request row (S-07 2b)", () => {
  it("renders as one: its verb, the asker's mark and the Send icon (mutations: return null for the documentRequest case, or wear the Paperclip -> FAILS)", () => {
    const entries = [{ kind: "documentRequest", id: "r1", at: AT, contactId: "c1", request: { id: "r1", items: [{ key: "insurance", category: "insurance", note: null },
      { key: "other", category: "other", note: "Pool permit" }], channel: "text", created_by: "user_me", created_at: AT, contact_id: "c1", client_group_id: null } }] as TimelineEntry[];
    const tr = makeTr("es");
    const rows = timelineRows(entries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "es", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    const row = html.match(/<div data-timeline-item="documentRequest"[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(row).toContain(`>${m["timeline.documentRequest.es"].replace("{count}", "2")}<`);
    expect(row).toContain(`>${m["provenance.you.es"]}<`);
    expect(row).toContain("lucide-send");
  });
});

describe("a required-document skip and un-skip (S-07 2c)", () => {
  it("each renders as one: its verb, the person's mark and the ListChecks icon (mutations: return null for either case, or wear the Paperclip -> FAILS)", () => {
    const skip = { id: "k1", category: "insurance", contact_id: "c1", skipped_by: "user_me", created_at: AT, unskipped_by: "user_me", unskipped_at: AT };
    const entries = [
      { kind: "documentSkip", id: "k1", at: AT, contactId: "c1", skip },
      { kind: "documentUnskip", id: "k1", at: AT, contactId: "c1", skip },
    ] as TimelineEntry[];
    const tr = makeTr("es");
    const rows = timelineRows(entries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "es", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    for (const [kind, verb] of [["documentSkip", "marcó que Seguro no hace falta"], ["documentUnskip", "marcó que Seguro hace falta otra vez"]] as const) {
      const row = html.match(new RegExp(`<div data-timeline-item="${kind}"[\\s\\S]*?</li>`))?.[0] ?? "";
      expect(row).toContain(`>${verb}<`);
      expect(row).toContain(`>${m["provenance.you.es"]}<`);
      expect(row).toContain("lucide-list-checks");
    }
  });
});
