import { describe, it, expect } from "vitest";
import { togglePageSelection, pageSelectionState } from "./selection";

describe("page selection", () => {
  const page = ["a", "b", "c"];
  it("selects the whole page from empty, then clears it", () => {
    const all = togglePageSelection(new Set(), page);
    expect([...all].sort()).toEqual(page);
    expect(pageSelectionState(all, page)).toBe("all");
    expect(togglePageSelection(all, page).size).toBe(0);
  });
  it("partial page -> toggling completes the page and keeps off-page ids", () => {
    const partial = new Set(["a", "zz-off-page"]);
    expect(pageSelectionState(partial, page)).toBe("some");
    const all = togglePageSelection(partial, page);
    expect(all.has("zz-off-page")).toBe(true);
    expect(pageSelectionState(all, page)).toBe("all");
  });
});
