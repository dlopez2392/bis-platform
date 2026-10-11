import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// "use server" actions and the client composer are not rendered here; only the task rows are read.
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions", () => ({
  assignContactsAction: vi.fn(), undoAssignContactsAction: vi.fn(),
}));
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions", () => ({ setTaskAssigneeAction: vi.fn() }));

const { ActivityTimeline } = await import("./activity-timeline");

const ANA = { userId: "11111111-1111-4111-8111-111111111111", label: "Ana Ruiz", role: "staff" as const };
const task = (id: string, title: string, assigned_to: string | null, completed_at: string | null = null) =>
  ({ id, title, due_at: null, completed_at, created_at: "2026-10-09T17:00:00Z", consent_event_id: null, call_id: null, assigned_to });

function render(canAssign: boolean, tasks: ReturnType<typeof task>[]) {
  return renderToStaticMarkup(createElement(ActivityTimeline, {
    accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
    smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
    notes: [], tasks, holdOpenTaskIds: [], opportunities: [], submissions: [], messages: [],
    emailAction: async () => {}, smsAction: async () => {}, timezone: "America/Chicago",
    canAssign, members: [ANA],
  } as never));
}
const rowOf = (html: string, title: string) => html.split("<li").slice(1).find((r) => r.includes(title)) ?? "";

/**
 * F-085 part 1 (spec §9): each open task on the record carries its own
 * "Assigned to" picker for someone who may hand tasks on. A Technician's page
 * has no team to name a holder by, so the picker is left out for them.
 */
describe("the record's task rows: Assigned to (F-085)", () => {
  it("an open task shows a picker reading as its holder (mutation: drop the picker -> FAILS)", () => {
    const r = rowOf(render(true, [task("t1", "Order shingles", ANA.userId)]), "Order shingles");
    expect(r).toContain('role="combobox"');
    expect(r).toContain(`aria-label="${m["assign.field.label"]}"`);
    expect(renderedText(r)).toContain(ANA.label);
  });

  it("an unassigned open task reads Unassigned", () => {
    expect(renderedText(rowOf(render(true, [task("t1", "Order shingles", null)]), "Order shingles"))).toContain(m["assign.unassigned"]);
  });

  it("without canAssign (a Technician) there is no picker (mutation: render it for everyone -> FAILS)", () => {
    expect(rowOf(render(false, [task("t1", "Order shingles", ANA.userId)]), "Order shingles")).not.toContain('role="combobox"');
  });

  it("a done task carries no picker: there is nothing left to hand on", () => {
    expect(rowOf(render(true, [task("t1", "Order shingles", ANA.userId, "2026-10-10T00:00:00Z")]), "Order shingles"))
      .not.toContain('role="combobox"');
  });
});
