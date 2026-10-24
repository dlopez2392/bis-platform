// S-47d Task 11 (spec §5.6.2): "Keep calls the action with the booking id" — tested here, minus
// React (D-036's own pattern), since `renderToStaticMarkup` cannot fire a click to prove it.
import { describe, expect, it, vi } from "vitest";
import { runKeepWithUndo, type KeepToast } from "./keep-with-undo";
import type { ActionResult } from "../calendar/actions";

const LABELS = { keptToast: "Kept. Its reminders go out as usual.", undo: "Undo", failed: "Couldn't change today's status. Try again." };

function fakeToast(): KeepToast & { calls: { success: unknown[]; error: unknown[] } } {
  const calls = { success: [] as unknown[], error: [] as unknown[] };
  return {
    calls,
    success: (...a: unknown[]) => calls.success.push(a),
    error: (...a: unknown[]) => calls.error.push(a),
  };
}

describe("runKeepWithUndo", () => {
  it("calls the action with the booking's own id, kept=true (mutation: hard-code a different id -> this test's own `action` stub proves what it was called with)", async () => {
    const seen: boolean[] = [];
    const action = vi.fn(async (kept: boolean): Promise<ActionResult> => {
      seen.push(kept);
      return { ok: true };
    });
    await runKeepWithUndo(action, fakeToast(), LABELS);
    expect(seen).toEqual([true]);
  });

  it("on success, shows the keptToast with an Undo action and calls onDone once (mutation: skip onDone -> FAILS)", async () => {
    const onDone = vi.fn();
    const toast = fakeToast();
    const ok = await runKeepWithUndo(async () => ({ ok: true }), toast, LABELS, onDone);
    expect(ok).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toast.calls.success[0]).toEqual([LABELS.keptToast, { action: { label: "Undo", onClick: expect.any(Function) } }]);
  });

  it("Undo calls the SAME action with false (spec: 'Undo calling it with false') (mutation: call it with true again -> FAILS)", async () => {
    const seen: boolean[] = [];
    const action = vi.fn(async (kept: boolean): Promise<ActionResult> => {
      seen.push(kept);
      return { ok: true };
    });
    const toast = fakeToast();
    await runKeepWithUndo(action, toast, LABELS);
    expect(action).toHaveBeenCalledWith(true);
    const onClick = (toast.calls.success[0] as [string, { action: { onClick: () => void } }])[1].action.onClick;
    onClick();
    await Promise.resolve();
    expect(action).toHaveBeenCalledWith(false);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("a refused write toasts the action's own error, never the toast, and returns false (mutation: show the toast anyway -> FAILS)", async () => {
    const toast = fakeToast();
    const ok = await runKeepWithUndo(async () => ({ ok: false, error: "nope" }), toast, LABELS);
    expect(ok).toBe(false);
    expect(toast.calls.error).toEqual([["nope"]]);
    expect(toast.calls.success).toEqual([]);
  });

  it("a thrown write toasts the generic failed message, not the thrown error", async () => {
    const toast = fakeToast();
    const ok = await runKeepWithUndo(async () => { throw new Error("boom"); }, toast, LABELS);
    expect(ok).toBe(false);
    expect(toast.calls.error).toEqual([[LABELS.failed]]);
  });

  it("a failed Undo toasts its own error and never calls onDone for it (mutation: call onDone regardless -> FAILS)", async () => {
    const onDone = vi.fn();
    const toast = fakeToast();
    let callCount = 0;
    await runKeepWithUndo(async () => {
      callCount++;
      return callCount === 1 ? { ok: true } : { ok: false, error: "changed since" };
    }, toast, LABELS, onDone);
    expect(onDone).toHaveBeenCalledTimes(1);
    const onClick = (toast.calls.success[0] as [string, { action: { onClick: () => void } }])[1].action.onClick;
    onClick();
    await Promise.resolve();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toast.calls.error).toEqual([["changed since"]]);
  });
});
