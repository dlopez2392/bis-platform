import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";
import type { ActFacts } from "@/lib/ai-acts/kinds/types";

/**
 * item 8c (plan Task 6): the page's own `case "aiAct"` renders the act's Undo (`ActRow`), not the plain
 * row Task 3 left behind. No DOM (no jsdom): a click is undo-handlers.test.ts's and the e2e's.
 */
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-10-15T14:42:00.000Z";
const act = (over: Record<string, unknown> = {}) => ({
  id: "act1", accountId: "acct1", contactId: "c1", actor: "voice" as const, callId: "call1", chatId: null,
  kind: "contact_field_filled" as const, target: { field: "email" }, before: { value: null }, after: { value: "ana@example.com" },
  createdAt: AT, undoneAt: null, undoneBy: null, undoNotified: false, ...over,
});
const ENTRY = (a: ReturnType<typeof act>): TimelineEntry => ({ kind: "aiAct", id: a.id, at: AT, contactId: "c1", act: a } as unknown as TimelineEntry);
const FACTS: ActFacts = {
  now: new Date("2026-10-20T12:00:00Z"), bookings: {}, contact: { first_name: "Ana", last_name: "Ruiz", email: "ana@example.com" },
  heldBy: {}, editors: {}, canDelete: true, futureBooked: [],
};

const render = (a: ReturnType<typeof act>, facts: ActFacts | null = FACTS, locale: "en" | "es" = "en") => {
  const tr = makeTr(locale);
  const rows = timelineRows([ENTRY(a)], {
    zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: "Sofía", tr }, actFacts: facts,
  });
  const base = legacyTimeline({ accountId: "acct1", contactId: "c1", timezone: "America/Chicago", locale, emailAction: async () => {}, smsAction: async () => {} });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
};

describe("the aiAct row (item 8c, plan Task 6)", () => {
  it("renders through ActRow, with the AI mark and the Undo control (mutation: keep Task 3's bare row -> FAILS)", () => {
    const html = render(act());
    expect(html).toContain('data-timeline-item="aiAct"');
    expect(html).toContain("data-ai-act-row");
    expect(html).toMatch(/data-variant="ghost"[^>]*>Undo</);
  });

  it("a failed facts read (actFacts null) renders the row with no Undo at all", () => {
    const html = render(act(), null);
    expect(html).toContain("data-ai-act-row");
    expect(html).not.toMatch(/data-variant="ghost"[^>]*>Undo</);
  });
});
