import { describe, it, expect, vi } from "vitest";
import { runHeldAction, runUndoHeldEmail } from "./held-email-handlers";
import type { HeldActionResult, HeldUndo } from "./inbound-actions";

function toast() {
  return { success: vi.fn(), error: vi.fn() };
}

describe("runHeldAction (held-email-handlers)", () => {
  it("ok: toasts the success message with an Undo action, never restores the row (mutation: call onRestore on ok -> FAILS)", async () => {
    const t = toast();
    const onRestore = vi.fn();
    const runUndo = vi.fn(async () => {});
    const undo: HeldUndo = { kind: "unfile", id: "ie_1", messageId: "msg_1" };
    await runHeldAction(async () => ({ ok: true, undo } as HeldActionResult), t, "en", "Filed on Ana.", onRestore, runUndo);
    expect(t.success).toHaveBeenCalledWith("Filed on Ana.", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
    expect(onRestore).not.toHaveBeenCalled();
    // The toast's own Undo button, clicked, runs the undo the server answered — not a different one.
    (t.success.mock.calls[0]![1] as { action: { onClick: () => void } }).action.onClick();
    expect(runUndo).toHaveBeenCalledWith(undo);
  });

  it("changed: toasts changed and does NOT restore the row (mutation: restore on changed -> FAILS)", async () => {
    const t = toast();
    const onRestore = vi.fn();
    await runHeldAction(async () => ({ ok: false, error: "changed" } as HeldActionResult), t, "en", "x", onRestore, vi.fn());
    expect(t.error).toHaveBeenCalledWith("Someone already handled this email. Reload to see where it is.");
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("failed: toasts failed and DOES restore the row (mutation: skip onRestore on failed -> FAILS)", async () => {
    const t = toast();
    const onRestore = vi.fn();
    await runHeldAction(async () => ({ ok: false, error: "failed" } as HeldActionResult), t, "en", "x", onRestore, vi.fn());
    expect(t.error).toHaveBeenCalledWith("That didn't save. Try again.");
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("a thrown action toasts common.actionCrashed and restores the row (mutation: swallow the throw -> FAILS)", async () => {
    const t = toast();
    const onRestore = vi.fn();
    await runHeldAction(async () => { throw new Error("boom"); }, t, "en", "x", onRestore, vi.fn());
    expect(t.error).toHaveBeenCalledWith("That didn't go through — this page may be out of date. Reload it and try again.");
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("Spanish toasts (mutation: an English string in the es render -> FAILS)", async () => {
    const t = toast();
    await runHeldAction(async () => ({ ok: false, error: "changed" } as HeldActionResult), t, "es", "x", vi.fn(), vi.fn());
    expect(t.error).toHaveBeenCalledWith("Alguien ya atendió este correo. Vuelva a cargar para ver dónde está.");
  });
});

describe("runUndoHeldEmail", () => {
  it("ok: toasts undone and calls onUndone (mutation: skip onUndone -> FAILS)", async () => {
    const t = toast();
    const onUndone = vi.fn();
    await runUndoHeldEmail(async () => ({ ok: true }), t, "en", onUndone);
    expect(t.success).toHaveBeenCalledWith("Back in Needs a look.");
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it("not ok: toasts failed and never calls onUndone (mutation: call onUndone regardless -> FAILS)", async () => {
    const t = toast();
    const onUndone = vi.fn();
    await runUndoHeldEmail(async () => ({ ok: false }), t, "en", onUndone);
    expect(t.error).toHaveBeenCalledWith("That didn't save. Try again.");
    expect(onUndone).not.toHaveBeenCalled();
  });

  it("a throw toasts common.actionCrashed (mutation: swallow the throw -> FAILS)", async () => {
    const t = toast();
    await runUndoHeldEmail(async () => { throw new Error("boom"); }, t, "en", vi.fn());
    expect(t.error).toHaveBeenCalledWith("That didn't go through — this page may be out of date. Reload it and try again.");
  });
});
