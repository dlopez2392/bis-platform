import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

/**
 * The group page's timeline (S-03 part 2b, spec §8.8, C6-C8): one merged page across the household's
 * members, each row naming its member before its author mark, and READ-ONLY (D5, C7): no composer,
 * no add-To-do form, no Done, no hold hint and no assignee picker, because nothing here is about one
 * person. Writes happen on the member's own page, which the row's member link opens.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const retryProps: Record<string, unknown>[] = [];
vi.mock("@/components/record/record-card", () => ({
  RecordCardRetry: (p: Record<string, unknown>) => {
    retryProps.push(p);
    return createElement("button", { type: "button", "data-retry": "" }, p.label as string);
  },
}));

const { GroupTimeline } = await import("./group-timeline");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");
const { m } = await import("@/lib/messages");

const AT = "2026-10-09T16:12:00Z";
const EARLIER = "2026-10-08T16:12:00Z";
const ENTRIES: TimelineEntry[] = [
  { kind: "call", id: "k1", at: AT, contactId: "c-ana", call: { id: "k1", contact_id: "c-ana", started_at: AT, outcome: "booked", duration_secs: 180,
    reason: "Wants a quote for a roof leak.", summary: null, language: "en" } },
  { kind: "booking", id: "b1", at: AT, contactId: "c-luis", booking: { id: "b1", contact_id: "c-luis", created_at: AT, starts_at: "2026-10-16T15:00:00Z",
    status: "booked", note: null, author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } },
  { kind: "task", id: "t1", at: EARLIER, contactId: "c-maria", task: { id: "t1", title: "Call back about the gate", created_at: EARLIER,
    due_at: "2026-10-20T05:00:00Z", completed_at: null, consent_event_id: null, call_id: null, assigned_to: null, created_by: "user_me" } },
  { kind: "note", id: "n1", at: EARLIER, contactId: "c-maria", note: { id: "n1", body: "Gate code 4411", author_id: "user_me", created_at: EARLIER } },
] as unknown as TimelineEntry[];
const SUBJECTS = {
  "c-ana": { label: "Ana García", href: "/dashboard/accounts/a1/contacts/c-ana" },
  "c-luis": { label: "Luis García", href: "/dashboard/accounts/a1/contacts/c-luis" },
  "c-maria": { label: "Maria García", href: "/dashboard/accounts/a1/contacts/c-maria" },
};

function render(over: Record<string, unknown> = {}, locale: "en" | "es" = "en") {
  const tr = makeTr(locale);
  const rows = timelineRows(ENTRIES, {
    zone: "America/Chicago", tr, subjects: SUBJECTS,
    author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr },
  });
  return renderToStaticMarkup(createElement(GroupTimeline, {
    accountId: "a1", timezone: "America/Chicago", rows, failedText: null, emptyText: null,
    pager: { olderHref: null, newerHref: null }, tr, customerLangs: {}, ...over,
  } as never));
}
const rowHtml = (html: string, kind: string) =>
  html.match(new RegExp(`<div data-timeline-item="${kind}"[\\s\\S]*?</li>`))?.[0] ?? "";

describe("GroupTimeline (S-03 part 2b, spec §8.8)", () => {
  it("each row names its member FIRST, a link to their page, then the author mark, then the verb (C8; mutation: drop subject from the rows -> FAILS)", () => {
    const html = render();
    const call = rowHtml(html, "call");
    expect(call).toMatch(/<a (?=[^>]*href="\/dashboard\/accounts\/a1\/contacts\/c-ana")(?=[^>]*data-timeline-subject)[^>]*>Ana García<\/a>/);
    expect(call.indexOf("data-timeline-subject")).toBeLessThan(call.indexOf("data-author-mark"));
    expect(call.indexOf("data-author-mark")).toBeLessThan(call.indexOf(m["timeline.answeredCall"]));
    // The customer's own booking keeps its mark beside its member (DESIGN.md, Provenance).
    const booking = rowHtml(html, "booking");
    expect(booking).toContain(">Luis García</a>");
    expect(booking).toMatch(/data-author-mark="customer"/);
    expect([...html.matchAll(/data-timeline-subject/g)]).toHaveLength(4);
  });

  it("a call row keeps its Open call link (mutation: drop the call's action -> FAILS)", () => {
    const call = rowHtml(render(), "call");
    expect(call).toMatch(/<a (?=[^>]*href="\/dashboard\/accounts\/a1\/calls\/k1")(?=[^>]*data-timeline-open-call)[^>]*>Open call<\/a>/);
  });

  it("is read-only: no composer, no add-To-do form, no Done, no hold hint, no assignee picker (D5, C7; mutation: render ActivityTimeline instead -> FAILS on the composer)", () => {
    const html = render({ holdOpenTaskIds: ["t1"], canAssign: true, members: [{ id: "u2", name: "Dan" }] });
    expect(html).not.toContain("data-timeline-composer");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
    expect(html).not.toContain(`>${m["contact.done"]}<`);
    expect(html).not.toContain(m["todo.consent.timelineHint"]);
    expect(html).not.toContain(m["contact.addTask"]);
    // The To-do still reads as one, with its due date in the account's zone.
    const task = rowHtml(html, "task");
    expect(task).toContain(">Call back about the gate<");
    expect(task).toContain("Oct 20, 2026");
  });

  it("typed text keeps lang=\"\" (part 1 C11; mutation: drop lang on the note body -> FAILS)", () => {
    expect(rowHtml(render(), "note")).toMatch(/<p lang=""[^>]*>Gate code 4411<\/p>/);
  });

  it("rows sit under day separators in the account's zone, newest first", () => {
    const html = render();
    expect(html.indexOf("data-timeline-item=\"call\"")).toBeLessThan(html.indexOf("data-timeline-item=\"note\""));
    expect(html).toContain("Oct 9, 2026");
    expect(html).toContain("Oct 8, 2026");
  });

  it("the empty sentence shows when the page hands one, with no list (rule 5; mutation: ignore emptyText -> FAILS)", () => {
    const tr = makeTr("en");
    const html = renderToStaticMarkup(createElement(GroupTimeline, {
      accountId: "a1", timezone: "UTC", rows: [], failedText: null, emptyText: tr.text("groupPage.timeline.empty"),
      pager: { olderHref: null, newerHref: null }, tr, customerLangs: {},
    }));
    expect(html).toMatch(/<p data-timeline-empty[^>]*>Texts, calls, bookings, notes and To-dos with these people show up here\. Open a person to start one\.<\/p>/);
    expect(html).not.toContain("<ol");
  });

  it("some sources failed: the rows that loaded stay, the failure is said, with Try again (spec §8.8; mutation: drop failedText -> FAILS)", () => {
    retryProps.length = 0;
    const html = render({ failedText: "Couldn't load calls." });
    expect(html).toMatch(/<div role="alert" data-timeline-failed[^>]*><p[^>]*>Couldn&#x27;t load calls\.<\/p><button[^>]*data-retry=""[^>]*>Try again<\/button>/);
    expect(retryProps).toEqual([{ label: m["record.card.retry"] }]);
    expect(html).toContain("data-timeline-item=\"call\"");
  });

  it("ONE pager: Newer and Older in one nav, on the timeline's anchor (DESIGN.md, Paged lists; mutation: a second nav -> FAILS)", () => {
    const html = render({ pager: { olderHref: "/x?before=abc#record-timeline", newerHref: "/x#record-timeline" } });
    expect(html.match(/<nav /g)).toHaveLength(1);
    expect(html).toMatch(/<nav aria-label="Pages" data-timeline-pager[^>]*><a [^>]*href="\/x#record-timeline"[^>]*>Newer<\/a><a [^>]*href="\/x\?before=abc#record-timeline"[^>]*>Older<\/a><\/nav>/);
    expect(html).toContain('id="record-timeline"');
    expect(render()).not.toContain("<nav");
  });

  it("Spanish: the verbs and the pager in Spanish, the member's name as typed (D10)", () => {
    const html = render({ pager: { olderHref: "/x?before=abc", newerHref: null } }, "es");
    expect(html).toContain(">Ana García</a>");
    expect(html).toContain(`>${m["timeline.older.es"]}<`);
    expect(html).toContain(m["timeline.openCall.es"]);
  });
  it("a document row renders as one: its verb and, for the group's own file (contactId \"\"), no member link (S-07; mutation: return null for the document case -> FAILS)", () => {
    const docEntries = [{ kind: "document", id: "d1", at: AT, contactId: "", document: { id: "d1", title: "Signed lease", category: "contract", source: "upload",
      created_by: "user_me", created_at: AT, deleted_at: null, contact_id: null, client_group_id: "g1" } }] as unknown as TimelineEntry[];
    const tr = makeTr("es");
    const rows = timelineRows(docEntries, { zone: "America/Chicago", tr, subjects: SUBJECTS, author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr } });
    const row = rowHtml(render({ rows, tr }, "es"), "document");
    expect(row).toContain(`>${m["timeline.document.es"].replace("{title}", "Signed lease")}<`);
    expect(row).not.toContain("data-timeline-subject");
  });
  it("a new-version row renders as one: its verb, the uploader's mark and, for the group's own file (contactId \"\"), no member link (S-07 1b, owner ruling R2; mutation: return null for the documentVersion case -> FAILS)", () => {
    const verEntries = [{ kind: "documentVersion", id: "v2", at: AT, contactId: "", version: { id: "v2", document_id: "d1", title: "Signed lease", category: "contract",
      uploaded_by: "user_me", created_at: AT, deleted_at: null, contact_id: null, client_group_id: "g1" } }] as unknown as TimelineEntry[];
    const tr = makeTr("es");
    const rows = timelineRows(verEntries, { zone: "America/Chicago", tr, subjects: SUBJECTS, author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr } });
    const row = rowHtml(render({ rows, tr }, "es"), "documentVersion");
    expect(row).toContain(`>${m["timeline.documentVersion.es"].replace("{title}", "Signed lease")}<`);
    expect(row).toContain(`>${m["provenance.you.es"]}<`);
    expect(row).not.toContain("data-timeline-subject");
  });

  it("a removed-file row renders as one: its verb, the automation mark and, for the group's own file (contactId \"\"), no member link (S-07 2a; mutation: return null for the documentRemoved case -> FAILS)", () => {
    const removedEntries: TimelineEntry[] = [{ kind: "documentRemoved", id: "v9", at: AT, contactId: "", scan: { id: "v9", document_id: "d1",
      scan_status: "infected", scan_signature: null, scanned_at: AT, title: "Lease", category: "contract", deleted_at: null, contact_id: null, client_group_id: "g1" } }];
    const tr = makeTr("es");
    const rows = timelineRows(removedEntries, { zone: "America/Chicago", tr, subjects: SUBJECTS, author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr } });
    const row = rowHtml(render({ rows, tr }, "es"), "documentRemoved");
    expect(row).toContain(`>${m["timeline.documentRemoved.es"].replace("{title}", "Lease")}<`);
    expect(row).toContain(`>${m["provenance.automation.es"]}<`);
    expect(row).not.toContain("data-timeline-subject");
  });
});

describe("a document-request row on the group page (S-07 2b)", () => {
  it("renders as one: its verb, the asker's mark, the Send icon and, for the group's own request (contactId \"\"), no member link (mutations: return null for the documentRequest case, or wear the Paperclip -> FAILS)", () => {
    const entries = [{ kind: "documentRequest", id: "r1", at: AT, contactId: "", request: { id: "r1", items: [{ key: "insurance", category: "insurance", note: null }],
      channel: "link", created_by: "user_me", created_at: AT, contact_id: null, client_group_id: "g1" } }] as TimelineEntry[];
    const tr = makeTr("es");
    const rows = timelineRows(entries, { zone: "America/Chicago", tr, subjects: SUBJECTS, author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr } });
    const row = rowHtml(render({ rows, tr }, "es"), "documentRequest");
    expect(row).toContain(`>${m["timeline.documentRequestOne.es"]}<`);
    expect(row).toContain(`>${m["provenance.you.es"]}<`);
    expect(row).toContain("lucide-send");
    expect(row).not.toContain("data-timeline-subject");
  });
});

describe("a required-document skip and un-skip on the group page (S-07 2c)", () => {
  it("each renders as one: its verb, the person's mark, the ListChecks icon and its member's link (mutations: return null for either case, or wear the Paperclip -> FAILS)", () => {
    const skip = { id: "k1", category: "insurance", contact_id: "c-ana", skipped_by: "user_me", created_at: AT, unskipped_by: "user_me", unskipped_at: AT };
    const entries = [
      { kind: "documentSkip", id: "k1", at: AT, contactId: "c-ana", skip },
      { kind: "documentUnskip", id: "k1", at: AT, contactId: "c-ana", skip },
    ] as TimelineEntry[];
    const tr = makeTr("es");
    const rows = timelineRows(entries, { zone: "America/Chicago", tr, subjects: SUBJECTS, author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr } });
    const html = render({ rows, tr }, "es");
    for (const [kind, verb] of [["documentSkip", "marcó que Seguro no hace falta"], ["documentUnskip", "marcó que Seguro hace falta otra vez"]] as const) {
      const row = rowHtml(html, kind);
      expect(row).toContain(`>${verb}<`);
      expect(row).toContain(`>${m["provenance.you.es"]}<`);
      expect(row).toContain("lucide-list-checks");
      expect(row).toContain("/dashboard/accounts/a1/contacts/c-ana");
    }
  });
});

describe("a share link and its first open on the group page (S-07 3b)", () => {
  it("each renders as one: its verb, the sharer's or the recipient's mark, its own icon and its member's link (mutations: return null for either case, or wear the Link2 icon on the open -> FAILS)", () => {
    const share = { id: "s1", document_id: "d1", title: "Seguro 2026.pdf", category: "insurance", created_by: "user_me", created_at: AT, first_opened_at: AT, contact_id: "c-ana", client_group_id: null, deleted_at: null };
    const entries = [
      { kind: "documentShareOpened", id: "s1", at: AT, contactId: "c-ana", share },
      { kind: "documentShared", id: "s1", at: AT, contactId: "c-ana", share },
    ] as TimelineEntry[];
    const tr = makeTr("es");
    const rows = timelineRows(entries, { zone: "America/Chicago", tr, subjects: SUBJECTS, author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr } });
    const html = render({ rows, tr }, "es");
    const sharedRow = rowHtml(html, "documentShared");
    expect(sharedRow).toContain(">compartió Seguro 2026.pdf<");
    expect(sharedRow).toContain(`>${m["provenance.you.es"]}<`);
    expect(sharedRow).toContain("lucide-link-2");
    expect(sharedRow).toContain("/dashboard/accounts/a1/contacts/c-ana");
    const openedRow = rowHtml(html, "documentShareOpened");
    expect(openedRow).toContain(">abrió Seguro 2026.pdf<");
    expect(openedRow).toContain(`>${m["provenance.linkRecipient.es"]}<`);
    expect(openedRow).toContain("lucide-download");
    expect(openedRow).toContain("/dashboard/accounts/a1/contacts/c-ana");
  });
});

const { renderedText } = await import("@/lib/rendered-text");
const { buttonVariants } = await import("@/components/ui/button");
const { cn } = await import("@/lib/utils");
describe("a website chat row on the group page (S-06 part 3, spec §7; G18, G20, G23, G25)", () => {
  const chatRow = (matchedExisting: boolean, locale: "en" | "es") => {
    const tr = makeTr(locale);
    const entries: TimelineEntry[] = [{ kind: "chat", id: "m0", at: AT, contactId: "c-ana", chat: { conversationId: "cv1", count: 12, matchedExisting } }];
    const rows = timelineRows(entries, { zone: "America/Chicago", tr, subjects: SUBJECTS, author: { viewerId: "user_me", names: {}, personaName: "Rosa", tr } });
    return rowHtml(render({ rows, tr }, locale), "chat");
  };
  const openChat = (row: string) => row.match(/<a [^>]*data-timeline-open-chat[^>]*>[^<]*<\/a>/)?.[0] ?? "";

  it("renders its member, the customer's mark, the verb and the count, and an Open chat ghost link to its thread in the inbox (mutation: link to the record -> FAILS)", () => {
    for (const [locale, words, open] of [
      ["en", ["Ana García", "Customer", "chatted with Rosa on your website", "12 messages"], "Open chat"],
      ["es", ["Ana García", "Cliente", "conversó con Rosa en su sitio web", "12 mensajes"], "Ver chat"],
    ] as const) {
      const row = chatRow(false, locale);
      const text = renderedText(row).replace(/\s+/g, " ");
      for (const w of words) expect(text).toContain(w);
      expect(row).toMatch(/data-author-mark="customer"/);
      expect(row).toContain("lucide-messages-square");
      const link = openChat(row);
      expect(link).toMatch(/href="\/dashboard\/accounts\/a1\/conversations\?c=cv1"/);
      expect(renderedText(link).trim()).toBe(open);
      // The Open call link's own classes: the ghost variant at sm, then the 44px touch target (rule 8).
      expect(renderedText(link.match(/class="([^"]*)"/)?.[1] ?? "")).toBe(cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8"));
      expect(row).not.toContain("data-webchat-unconfirmed");
    }
  });

  it("a chat matched to an existing customer carries the unconfirmed line, lang set to the page's language (G18; mutation: drop lang -> FAILS)", () => {
    for (const [locale, line] of [
      ["en", "Matched by the phone or email they typed; not confirmed."],
      ["es", "Lo relacionamos por el teléfono o el correo que escribió; no está confirmado."],
    ] as const) {
      const p = chatRow(true, locale).match(/<p [^>]*data-webchat-unconfirmed=""[^>]*>[^<]*<\/p>/)?.[0] ?? "";
      expect(p).toMatch(new RegExp(`^<p (?=[^>]*lang="${locale}")`));
      expect(renderedText(p).trim()).toBe(line);
    }
  });
});

// Design review C1: the row switch is exhaustive. The group page reads no suggestions today
// (group-loaders.ts), but a suggestion row that reached it would render, never as an empty <li>.
describe("GroupTimeline: an accepted suggestion row (item 8b-2, design review C1)", () => {
  it("renders through TimelineItem with its parts, not as an empty row (mutation: drop the suggestion case -> FAILS)", () => {
    const tr = makeTr("en");
    const entry = { kind: "suggestion", id: "p1", at: AT, contactId: "c-ana", suggestion: {
      proposal: { id: "p1", accountId: "a1", source: "call", callId: "k1", contactId: "c-ana", kind: "task",
        payload: { title: "Send the quote", dueAt: null }, evidence: "x", evidenceRef: {}, evidenceLang: "en", status: "accepted",
        expiredReason: null, appliedPayload: null, appliedRef: null, decidedAt: AT, decidedBy: "user_me", undoneAt: null, undoneBy: null,
        expiresAt: AT, createdAt: EARLIER },
      applied: { title: "Send the quote", dueAt: null } } } as unknown as TimelineEntry;
    const rows = timelineRows([entry], { zone: "America/Chicago", tr, subjects: SUBJECTS, author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr } });
    const html = renderToStaticMarkup(createElement(GroupTimeline, {
      accountId: "a1", timezone: "America/Chicago", rows, failedText: null, emptyText: null,
      pager: { olderHref: null, newerHref: null }, tr, customerLangs: {},
    } as never));
    expect(html).toContain('data-timeline-item="suggestion"');
    expect(html).toContain('<span lang="en">Send the quote</span>');
  });
});
