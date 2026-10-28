import { describe, expect, it, vi } from "vitest";
import { returnFocusToRow } from "./drawer-focus";

// Found 2026-10-28 by a built-app keyboard check: Esc closed the contact
// drawer and focus landed on <body>. The drawer is a controlled Sheet with no
// Radix Trigger, so Radix's own close handler ("focus the trigger") had
// nothing to focus. Keyboard row nav (DESIGN.md DoD) needs the row back.
function fakeDoc(ids: string[]) {
  const rows = ids.map((id) => ({ id, focus: vi.fn(), getAttribute: (a: string) => (a === "data-contact-row" ? id : null) }));
  return {
    rows,
    doc: { querySelectorAll: (sel: string) => (sel === "[data-contact-row]" ? rows : []) },
  };
}

describe("returnFocusToRow: closing the drawer gives focus back to the row that opened it", () => {
  it("focuses the row whose data-contact-row is the drawer's contact, and only that row", () => {
    const { rows, doc } = fakeDoc(["c0", "c1", "c2"]);
    const event = { preventDefault: vi.fn() };
    returnFocusToRow(event, "c1", doc);
    expect(rows.map((r) => r.focus.mock.calls.length)).toEqual([0, 1, 0]);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("matches the id exactly, not as a prefix", () => {
    const { rows, doc } = fakeDoc(["c10", "c1"]);
    returnFocusToRow({ preventDefault: vi.fn() }, "c1", doc);
    expect(rows.map((r) => r.focus.mock.calls.length)).toEqual([0, 1]);
  });

  it("does nothing more when the row is not on this page (a deep link or a remembered row)", () => {
    const { rows, doc } = fakeDoc(["c0"]);
    const event = { preventDefault: vi.fn() };
    expect(() => returnFocusToRow(event, "c9", doc)).not.toThrow();
    expect(rows[0]!.focus).not.toHaveBeenCalled();
  });

  it("does nothing when no row was ever shown", () => {
    const { rows, doc } = fakeDoc(["c0"]);
    returnFocusToRow({ preventDefault: vi.fn() }, null, doc);
    expect(rows[0]!.focus).not.toHaveBeenCalled();
  });
});
