import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

/**
 * F-006 part 1 (plan Task 9, Task 11): the merge/mergeUndone row on the record page's timeline, and
 * (Task 11) its own "Undo merge" ghost control while `undo_until` is still in the future. Render
 * approach copied from activity-timeline.archive.test.ts.
 */
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const undoMergeActionMock = vi.fn();
vi.mock("../merge-actions", () => ({ undoMergeAction: (...a: unknown[]) => undoMergeActionMock(...a) }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");
const { undoMergeOne } = await import("./merge-undo");

const AT = "2026-10-09T16:12:00Z";
const FUTURE = "2099-01-01T00:00:00Z";
const PAST = "2020-01-01T00:00:00Z";
const render = (entries: TimelineEntry[], locale: "en" | "es" = "en", canMerge = true, nowMs?: number | null) => {
  const tr = makeTr(locale);
  const rows = timelineRows(entries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: { user_dan: "Dan López" }, personaName: null, tr } });
  const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale, emailAction: async () => {}, smsAction: async () => {}, canMerge });
  const clock = nowMs === null ? { nowMs: undefined } : nowMs === undefined ? {} : { nowMs };
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, ...clock, rows, emptyText: null } as never));
};
const row = (html: string, kind: string) => html.match(new RegExp(`<div data-timeline-item="${kind}"[\\s\\S]*?</li>`))?.[0] ?? "";
const TM = (over: Record<string, unknown> = {}) => ({
  mergeId: "1", otherId: "c9", otherFirstName: "Other", otherLastName: "Person", otherVisible: true,
  mergedBy: "user_dan", mergedAt: AT, undoUntil: FUTURE, undoneAt: null, undoneBy: null, counts: { notes: 1 }, ...over,
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

/**
 * F-006 part 1 (plan Task 11, spec §6.4): "Undo merge" while `undo_until` is still in the future
 * (owner ruling D7, 30 days), ghost, calling `undoMergeAction(accountId, Number(mergeId))` — never
 * the other record's id.
 */
describe("the merge row's own 'Undo merge' control (F-006 part 1, plan Task 11)", () => {
  const entry = (over: Record<string, unknown> = {}): TimelineEntry[] => [
    { kind: "merge", id: "1", at: AT, contactId: "c1", merge: TM(over) } as TimelineEntry,
  ];

  it("a future undoUntil, no undoneAt and canMerge true renders the button, naming the MERGE id, never the other record's (mutation: pass the kept id -> FAILS)", () => {
    const r = row(render(entry()), "merge");
    expect(r).toContain("Undo merge");
    expect(r).toMatch(/data-merge-undo-id="1"/);
    expect(r).not.toMatch(/data-merge-undo-id="c9"/);
  });

  it("past undoUntil: no button (mutation: ignore undoUntil -> FAILS)", () => {
    const r = row(render(entry({ undoUntil: PAST })), "merge");
    expect(r).not.toContain("Undo merge");
  });

  it("already undone (undoneAt set, even on a 'merge' row): no button (mutation: ignore undoneAt -> FAILS)", () => {
    const r = row(render(entry({ undoneAt: AT, undoneBy: "user_dan" })), "merge");
    expect(r).not.toContain("Undo merge");
  });

  it("the window is judged against the PAGE's clock, never the render's own: undoUntil 2026-11-01, page clock a day before -> button; a day after -> none; no clock -> none (mutation: compare with Date.now() -> FAILS)", () => {
    const until = "2026-11-01T00:00:00Z";
    const day = 86_400_000;
    expect(row(render(entry({ undoUntil: until }), "en", true, Date.parse(until) - day), "merge")).toContain("Undo merge");
    expect(row(render(entry({ undoUntil: until }), "en", true, Date.parse(until) + day), "merge")).not.toContain("Undo merge");
    expect(row(render(entry(), "en", true, null), "merge")).not.toContain("Undo merge");
  });

  it("canMerge false (a Technician): no button even with a future undoUntil (mutation: ignore canMerge -> FAILS)", () => {
    const r = row(render(entry(), "en", false), "merge");
    expect(r).not.toContain("Undo merge");
  });

  it("a mergeUndone row never carries the button either (control; mutation: show it on mergeUndone too -> FAILS)", () => {
    const entries: TimelineEntry[] = [{ kind: "mergeUndone", id: "2", at: AT, contactId: "c1", merge: TM({ undoneAt: AT, undoneBy: "user_dan" }) } as TimelineEntry];
    const r = row(render(entries), "mergeUndone");
    expect(r).not.toContain("Undo merge");
  });

  it("is a ghost button, never a second primary (rule 8; mutation: default variant -> FAILS)", () => {
    const r = row(render(entry()), "merge");
    expect(r).toMatch(/data-variant="ghost"[^>]*>Undo merge/);
  });
});

/**
 * `undoMergeOne` (merge-undo.tsx): the toast's own Undo and the row's "Undo merge" button both call
 * this. Tested directly — no DOM renderer runs onClick (archive-controls.test.ts's own pattern).
 */
describe("undoMergeOne: the exported handler (F-006 part 1, plan Task 11)", () => {
  beforeEach(() => { undoMergeActionMock.mockReset(); toasts.success.mockReset(); toasts.error.mockReset(); });

  it("calls undoMergeAction(accountId, mergeId) — a number, never a string id (mutation: pass the kept id -> FAILS)", async () => {
    undoMergeActionMock.mockResolvedValue({ ok: true, otherId: "c9", keptNew: 0, keptEdits: [] });
    const onDone = vi.fn();
    await undoMergeOne("a1", 1, "Other Person", "en", onDone);
    expect(undoMergeActionMock).toHaveBeenCalledWith("a1", 1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("success toasts contacts.merge.undone naming the other person, with no extra lines when nothing arrived or changed since (mutation: always add a description -> FAILS)", async () => {
    undoMergeActionMock.mockResolvedValue({ ok: true, otherId: "c9", keptNew: 0, keptEdits: [] });
    await undoMergeOne("a1", 1, "Jose Garcia", "en", vi.fn());
    expect(toasts.success).toHaveBeenCalledWith("Merge undone. Jose Garcia is back as their own record.", undefined);
  });

  it("names what arrived since and what stayed changed, as their own lines (mutation: drop either -> FAILS)", async () => {
    undoMergeActionMock.mockResolvedValue({ ok: true, otherId: "c9", keptNew: 2, keptEdits: ["first_name", "phone"] });
    await undoMergeOne("a1", 1, "Jose Garcia", "en", vi.fn());
    const [, opts] = toasts.success.mock.calls[0]!;
    expect(opts.description).toContain("2 things that arrived after the merge stay with Jose Garcia.");
    expect(opts.description).toContain("Kept what was changed after the merge: first name and phone number.");
  });

  it("a refusal toasts the error key; onDone never runs (mutation: call onDone regardless -> FAILS)", async () => {
    undoMergeActionMock.mockResolvedValue({ ok: false, errorKey: "contacts.merge.undoExpired" });
    const onDone = vi.fn();
    await undoMergeOne("a1", 1, "Jose Garcia", "en", onDone);
    expect(toasts.error).toHaveBeenCalledWith("This merge is more than 30 days old and can't be undone.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a throw toasts contacts.merge.undoFailed, never an unhandled rejection (mutation: let it throw -> FAILS)", async () => {
    undoMergeActionMock.mockRejectedValue(new Error("down"));
    await undoMergeOne("a1", 1, "Jose Garcia", "en", vi.fn());
    expect(toasts.error).toHaveBeenCalledWith("Couldn't undo the merge. Nothing changed. Try again.");
  });
});
