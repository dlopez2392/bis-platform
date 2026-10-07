import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkRow } from "@bis/db";
import { m } from "@/lib/messages";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const task = (consent: WorkRow["consent"]): WorkRow => ({
  id: "task:t1", source: "task", accountId: "a1", contactId: "c1",
  title: "Ana may have asked to stop texts: “remove me”. Texts to them are on hold.",
  dueAt: null, occurredAt: "2026-10-05T10:00:00Z", consent,
});
const render = (row: WorkRow) => renderToStaticMarkup(createElement(WorkList, {
  buckets: { overdue: [], today: [row], waiting: [] }, accountId: "a1", contactNames: { c1: "Ana" }, timezone: "America/Chicago",
}));

describe("the consent To-do row (spec §6)", () => {
  it("a hold's To-do offers Confirm stop and Not a stop, both ghost, and no Done (mutation: render WorkRowActions for it → FAILS)", () => {
    const out = render(task({ eventId: "h1", action: "held" }));
    expect(out).toContain(`>${m["contact.texts.confirmStop"]}<`);
    expect(out).toContain(`>${m["contact.texts.notAStop"]}<`);
    expect(out).not.toContain(`>${m["work.done"]}<`);
    expect(out.match(/data-variant="ghost"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("a CANCEL stop's To-do keeps Done (mutation: give it the hold buttons → FAILS)", () => {
    const out = render(task({ eventId: "r1", action: "revoked" }));
    expect(out).toContain(`>${m["work.done"]}<`);
    expect(out).not.toContain(`>${m["contact.texts.confirmStop"]}<`);
  });
});
