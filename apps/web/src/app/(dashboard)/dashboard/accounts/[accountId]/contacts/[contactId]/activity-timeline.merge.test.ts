import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

/**
 * F-006 part 1 (plan Task 9): the merge/mergeUndone row on the record page's timeline. Render approach
 * copied from activity-timeline.archive.test.ts. No Undo control here — T11 adds it on top of this row.
 */
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-10-09T16:12:00Z";
const render = (entries: TimelineEntry[], locale: "en" | "es" = "en") => {
  const tr = makeTr(locale);
  const rows = timelineRows(entries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: { user_dan: "Dan López" }, personaName: null, tr } });
  const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale, emailAction: async () => {}, smsAction: async () => {} });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
};
const row = (html: string, kind: string) => html.match(new RegExp(`<div data-timeline-item="${kind}"[\\s\\S]*?</li>`))?.[0] ?? "";
const TM = (over: Record<string, unknown> = {}) => ({
  mergeId: "1", otherId: "c9", otherFirstName: "Other", otherLastName: "Person", otherVisible: true,
  mergedBy: "user_dan", mergedAt: AT, undoUntil: AT, undoneAt: null, undoneBy: null, counts: { notes: 1 }, ...over,
});

describe("a merge/mergeUndone row renders as one: its verb, its mark and the Merge/Undo2 icon (F-006 part 1, plan Task 9; mutation: return null for the merge case -> FAILS)", () => {
  it("a merge row carries the person mark who ran it, the merged verb, and the Merge icon", () => {
    const entries: TimelineEntry[] = [{ kind: "merge", id: "1", at: AT, contactId: "c1", merge: TM() } as TimelineEntry];
    const r = row(render(entries), "merge");
    expect(r).toContain(">merged Other Person into this record: 1 note moved here<");
    expect(r).toMatch(/data-author-mark="person"/);
    expect(r).toContain(">Dan López<");
    expect(r).toContain("lucide-merge ");
  });

  it("a mergeUndone row carries the person mark who undid it, the undo verb, and the Undo2 icon (mutation: wear the Merge icon on a mergeUndone -> FAILS)", () => {
    const entries: TimelineEntry[] = [{
      kind: "mergeUndone", id: "2", at: AT, contactId: "c1", merge: TM({ undoneAt: AT, undoneBy: "user_dan" }),
    } as TimelineEntry];
    const r = row(render(entries), "mergeUndone");
    expect(r).toContain(">undid the merge with Other Person<");
    expect(r).toContain("lucide-undo-2 ");
    expect(r).not.toContain("lucide-merge ");
  });

  it("in Spanish", () => {
    const entries: TimelineEntry[] = [{ kind: "merge", id: "1", at: AT, contactId: "c1", merge: TM() } as TimelineEntry];
    expect(row(render(entries, "es"), "merge")).toContain(">unió a Other Person con este registro: 1 nota pasaron aquí<");
  });
});
