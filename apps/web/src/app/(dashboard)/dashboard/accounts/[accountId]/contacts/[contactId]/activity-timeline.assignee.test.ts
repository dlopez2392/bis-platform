import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// "use server" actions and the client composer are not rendered here; only the task rows are read.
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
// Task 7 fix round 1 (I3): the picker's own behaviour is tested in
// components/assign/assign.test.ts; here only what a row HANDS it is pinned.
const taskFieldProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/components/assign/assignee-field", async () => {
  const { createElement: h } = await import("react");
  return {
    TaskAssigneeField: (p: Record<string, unknown>) => {
      taskFieldProps.push(p);
      return h("span", { "data-task-assignee": String(p.taskId) });
    },
  };
});

const { ActivityTimeline } = await import("./activity-timeline");

const ACCOUNT = "a0000000-0000-4000-8000-000000000001";
const ANA = { userId: "11111111-1111-4111-8111-111111111111", label: "Ana Ruiz", role: "staff" as const };
const task = (id: string, title: string, assigned_to: string | null, completed_at: string | null = null) =>
  ({ id, title, due_at: null, completed_at, created_at: "2026-10-09T17:00:00Z", consent_event_id: null, call_id: null, assigned_to });

function render(canAssign: boolean, tasks: ReturnType<typeof task>[]) {
  taskFieldProps.length = 0;
  return renderToStaticMarkup(createElement(ActivityTimeline, {
    accountId: ACCOUNT, contactId: "c1", contactHasEmail: false, contactHasPhone: false,
    smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, emailNoticeLine: null,
    notes: [], tasks, holdOpenTaskIds: [], opportunities: [], submissions: [], messages: [],
    emailAction: async () => {}, smsAction: async () => {}, timezone: "America/Chicago",
    canAssign, members: [ANA],
  } as never));
}

/**
 * F-085 part 1 (spec §9): each open task on the record carries its own
 * "Assigned to" picker for someone who may hand tasks on. A Technician's page
 * has no team to name a holder by, so the picker is left out for them.
 */
describe("the record's task rows: Assigned to (F-085)", () => {
  it("an open task hands the picker ITS id, THIS account, its holder and the team (fix round 1, I3; mutation: taskId={assign.accountId} -> FAILS)", () => {
    render(true, [task("t1", "Order shingles", ANA.userId)]);
    expect(taskFieldProps).toHaveLength(1);
    expect(taskFieldProps[0]).toMatchObject({ accountId: ACCOUNT, taskId: "t1", value: ANA.userId, options: [ANA] });
  });

  it("an unassigned open task hands value null", () => {
    render(true, [task("t1", "Order shingles", null)]);
    expect(taskFieldProps[0]!.value).toBeNull();
  });

  it("the picker renders inside that task's own row", () => {
    const row = render(true, [task("t1", "Order shingles", ANA.userId)]).split("<li").slice(1).find((r) => r.includes("Order shingles")) ?? "";
    expect(row).toContain('data-task-assignee="t1"');
  });

  it("without canAssign (a Technician) there is no picker (mutation: render it for everyone -> FAILS)", () => {
    render(false, [task("t1", "Order shingles", ANA.userId)]);
    expect(taskFieldProps).toHaveLength(0);
  });

  it("a done task carries no picker: there is nothing left to hand on", () => {
    render(true, [task("t1", "Order shingles", ANA.userId, "2026-10-10T00:00:00Z")]);
    expect(taskFieldProps).toHaveLength(0);
  });
});
