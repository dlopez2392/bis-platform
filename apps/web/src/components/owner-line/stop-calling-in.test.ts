import { describe, it, expect, vi } from "vitest";
import { deferredRemoval, STOP_CALLING_IN_UNDO_MS } from "./stop-calling-in";

/**
 * "Stop calling in" (design review Important 3): the removal waits behind a 10-second Undo, and a tab closed inside
 * that window never lets the toast close, so the revocation was silently cancelled. The controller forces it through
 * on `pagehide` (flushOnPageHide, the Preferences panel's own), runs it AT MOST once, and an Undo before any of that
 * means it never runs. A real EventTarget stands in for `window`.
 */
const hide = (t: EventTarget) => t.dispatchEvent(new Event("pagehide"));

describe("deferredRemoval: the Undo window of 'Stop calling in'", () => {
  it("the Undo window is 10 seconds (the toast's own duration)", () => {
    expect(STOP_CALLING_IN_UNDO_MS).toBe(10_000);
  });

  it("a page hidden inside the Undo window forces the removal through (mutation: drop the flushOnPageHide wiring -> FAILS)", () => {
    const target = new EventTarget();
    const commit = vi.fn();
    deferredRemoval(commit, target);
    expect(commit).not.toHaveBeenCalled();
    hide(target);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("the toast closing after a pagehide flush never removes twice (mutation: drop the done flag -> FAILS)", () => {
    const target = new EventTarget();
    const commit = vi.fn();
    const r = deferredRemoval(commit, target);
    hide(target);
    r.settle();
    hide(target);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("Undo inside the window means nothing is removed, by a pagehide or by the toast closing", () => {
    const target = new EventTarget();
    const commit = vi.fn();
    const r = deferredRemoval(commit, target);
    expect(r.undo()).toBe(true);
    hide(target);
    r.settle();
    expect(commit).not.toHaveBeenCalled();
  });

  it("an Undo arriving after the removal already went through says so (false), so the card does not pretend it was undone", () => {
    const target = new EventTarget();
    const commit = vi.fn();
    const r = deferredRemoval(commit, target);
    hide(target);
    expect(r.undo()).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("the toast closing without Undo removes once and lets go of the pagehide listener", () => {
    const target = new EventTarget();
    const remove = vi.spyOn(target, "removeEventListener");
    const commit = vi.fn();
    const r = deferredRemoval(commit, target);
    r.settle();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("pagehide", expect.any(Function));
  });
});
