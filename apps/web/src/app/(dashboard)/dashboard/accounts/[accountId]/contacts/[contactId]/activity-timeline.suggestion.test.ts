import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

/**
 * An accepted suggestion on the record's timeline (item 8b-2, spec 5.4; design review C1, final review
 * M-5). The row switch had no "suggestion" case and no default, so the row rendered as an EMPTY <li>.
 * It now renders the row through TimelineItem, drawn from its parts as the card is: the model's English
 * title keeps lang="en" (P18) and the field change's arrow is aria-hidden beside its spoken word.
 */
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/record/record-card", () => ({ RecordCardRetry: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-10-09T16:12:00+00:00";
const proposal = (id: string, status: "accepted" | "edited", kinded: Record<string, unknown>) => ({
  id, accountId: "a1", source: "call", callId: "k1", contactId: "c1", ...kinded, evidence: "x", evidenceRef: {},
  evidenceLang: "en", status, expiredReason: null, appliedPayload: null, appliedRef: null, decidedAt: AT,
  decidedBy: "user_dan", undoneAt: null, undoneBy: null, expiresAt: "2026-11-08T16:12:00+00:00", createdAt: "2026-10-08T16:12:00+00:00",
});
const SUGGESTION_ENTRIES = [
  { kind: "suggestion", id: "p1", at: AT, contactId: "c1", suggestion: {
    proposal: proposal("p1", "accepted", { kind: "task", payload: { title: "Send the quote", dueAt: null } }),
    applied: { title: "Send the quote", dueAt: null } } },
  { kind: "suggestion", id: "p2", at: AT, contactId: "c1", suggestion: {
    proposal: proposal("p2", "edited", { kind: "contact_field", payload: { field: "email", value: "ana@exmaple.com" } }),
    applied: { field: "email", value: "ana@example.com" } } },
] as unknown as TimelineEntry[];

const render = (locale: "en" | "es" = "en") => {
  const tr = makeTr(locale);
  const rows = timelineRows(SUGGESTION_ENTRIES, { zone: "America/Chicago", tr, author: { viewerId: null, names: { user_dan: "Dan López" }, personaName: "Rosa", tr } });
  const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale, emailAction: async () => {}, smsAction: async () => {} });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
};

describe("an accepted suggestion on the record's timeline (design review C1)", () => {
  it("renders as a row with its author mark and its words, never an empty <li> (mutation: drop the suggestion case -> FAILS)", () => {
    const html = render();
    expect(html.match(/data-timeline-item="suggestion"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<li[^>]*><\/li>/);
    expect(html).toContain(">Dan López<");
    expect(html).toContain("accepted Rosa&#x27;s suggestion: Add a to-do: ");
  });

  it("the model's title keeps lang en, and the arrow is drawn aria-hidden beside its spoken word, in the verb and the original (final review M-5; mutation: verb={row.verb} -> FAILS)", () => {
    const html = render();
    expect(html).toContain('<span lang="en">Send the quote</span>');
    expect(html.match(/<span aria-hidden="true">→<\/span><span class="sr-only">to<\/span>/g)).toHaveLength(2);
    expect(render("es")).toContain('<span aria-hidden="true">→</span><span class="sr-only">a</span>');
  });
});
