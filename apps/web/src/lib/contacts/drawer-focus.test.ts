import { describe, expect, it, vi } from "vitest";
import { returnFocusToRow, focusAfterBar, nextRowId } from "./drawer-focus";

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

// Final review M5: Archive, Restore and Delete unmount the bulk bar (the selection empties), and the drawer
// closes on them; either way the focused button is gone. Focus lands somewhere a keyboard can carry on from.
describe("focusAfterBar: the bar unmounted, focus goes to the select-all box, else the table", () => {
  const el = () => ({ focus: vi.fn() });
  it("the select-all checkbox when it is there (mutation: focus nothing -> FAILS)", () => {
    const box = el(), table = el();
    focusAfterBar({ querySelector: (s: string) => (s === "[data-select-page]" ? box : s === "[data-contacts-table]" ? table : null) });
    expect(box.focus).toHaveBeenCalledTimes(1);
    expect(table.focus).not.toHaveBeenCalled();
  });
  it("the table container when the box is gone, and nothing (no throw) when neither is", () => {
    const table = el();
    focusAfterBar({ querySelector: (s: string) => (s === "[data-contacts-table]" ? table : null) });
    expect(table.focus).toHaveBeenCalledTimes(1);
    expect(() => focusAfterBar({ querySelector: () => null })).not.toThrow();
  });
});

describe("nextRowId: the row that takes a gone row's place in the focus order", () => {
  it("the next row; the previous one for the last row; null when it was the only one or is not on the page (mutation: always the previous -> FAILS)", () => {
    expect(nextRowId(["c0", "c1", "c2"], "c1")).toBe("c2");
    expect(nextRowId(["c0", "c1", "c2"], "c2")).toBe("c1");
    expect(nextRowId(["c0"], "c0")).toBeNull();
    expect(nextRowId(["c0", "c1"], "c9")).toBeNull();
  });
});
