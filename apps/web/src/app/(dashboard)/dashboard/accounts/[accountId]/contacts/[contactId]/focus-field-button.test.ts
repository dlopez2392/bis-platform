import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";
import { FocusFieldButton } from "./focus-field-button";

afterEach(() => vi.unstubAllGlobals());

/** The click handler FocusFieldButton hands its Button (no DOM renderer here: the element's own prop). */
const clickOf = (targetId: string) =>
  (FocusFieldButton({ targetId, label: "Add a To-do" }) as ReactElement<{ onClick: () => void }>).props.onClick;

describe("FocusFieldButton (spec §9.3, review round 1, I1)", () => {
  it("a click finds the target by id, brings it into view and focuses it (mutation: delete el?.focus() -> FAILS)", () => {
    const target = { focus: vi.fn(), scrollIntoView: vi.fn() };
    const getElementById = vi.fn((id: string) => (id === "record-add-todo" ? target : null));
    vi.stubGlobal("document", { getElementById });
    clickOf("record-add-todo")();
    expect(getElementById).toHaveBeenCalledWith("record-add-todo");
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(target.focus).toHaveBeenCalledTimes(1);
  });
  it("a missing target is a no-op, never a throw", () => {
    vi.stubGlobal("document", { getElementById: () => null });
    expect(() => clickOf("gone")()).not.toThrow();
  });
});
