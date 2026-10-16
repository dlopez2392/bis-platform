import { describe, it, expect, vi } from "vitest";
import { applyReplies, probeDns, MODE_LABEL, type RepliesToast } from "./replies-row-handlers";
import { m } from "@/lib/messages";

function fakeToast(): RepliesToast & { calls: { success: unknown[][]; error: unknown[][] } } {
  const calls = { success: [] as unknown[][], error: [] as unknown[][] };
  return {
    success: (...args: unknown[]) => { calls.success.push(args); },
    error: (...args: unknown[]) => { calls.error.push(args); },
    calls,
  };
}

/**
 * Fix round 1 (code review, Task 10): a THROWN server action — a stale
 * deployment, an expired session (`lib/forms/action-feedback.ts`'s own
 * documented incident) — used to show no toast at all from this row's three
 * call sites. These tests exercise the extracted, DOM-free handler directly.
 */
describe("applyReplies — a thrown setReplies toasts crashed, not silence (mutation: drop the try/catch around `run()` in `guarded` → this test's promise REJECTS instead of resolving false, FAILS)", () => {
  it("writes, calls onApplied and arms an Undo toast on success", async () => {
    const toast = fakeToast();
    const onApplied = vi.fn();
    const onUndone = vi.fn();
    const setReplies = vi.fn().mockResolvedValue({ ok: true, previous: { mode: "off", domain: null } });
    const ok = await applyReplies({ setReplies, toast, onApplied, onUndone }, { mode: "bis", domain: null });
    expect(ok).toBe(true);
    expect(onApplied).toHaveBeenCalledWith({ mode: "bis", domain: null });
    expect(toast.calls.success).toHaveLength(1);
    expect(toast.calls.success[0]![0]).toBe(m["settings.replies.saved"].replace("{mode}", MODE_LABEL.bis));
  });

  it("toasts the server's refusal and never calls onApplied (mutation: call onApplied before checking result.ok → FAILS)", async () => {
    const toast = fakeToast();
    const onApplied = vi.fn();
    const setReplies = vi.fn().mockResolvedValue({ ok: false, error: "nope" });
    const ok = await applyReplies({ setReplies, toast, onApplied, onUndone: vi.fn() }, { mode: "bis", domain: null });
    expect(ok).toBe(false);
    expect(onApplied).not.toHaveBeenCalled();
    expect(toast.calls.error).toEqual([["nope"]]);
  });

  it("a THROWN setReplies toasts common.actionCrashed and resolves false, never calls onApplied (mutation: drop the catch → FAILS, the promise rejects instead of resolving)", async () => {
    const toast = fakeToast();
    const onApplied = vi.fn();
    const setReplies = vi.fn().mockRejectedValue(new Error("stale deployment"));
    const ok = await applyReplies({ setReplies, toast, onApplied, onUndone: vi.fn() }, { mode: "bis", domain: null });
    expect(ok).toBe(false);
    expect(onApplied).not.toHaveBeenCalled();
    expect(toast.calls.error).toEqual([[m["common.actionCrashed"]]]);
  });

  it("Undo calls setReplies(previous), onUndone and toasts undone on success (mutation: call onUndone before checking back.ok → FAILS)", async () => {
    const toast = fakeToast();
    const onUndone = vi.fn();
    const setReplies = vi.fn()
      .mockResolvedValueOnce({ ok: true, previous: { mode: "off", domain: null } })
      .mockResolvedValueOnce({ ok: true, previous: { mode: "bis", domain: null } });
    await applyReplies({ setReplies, toast, onApplied: vi.fn(), onUndone }, { mode: "bis", domain: null });
    const undo = (toast.calls.success[0]![1] as { action: { onClick: () => void } }).action;
    undo.onClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(setReplies).toHaveBeenLastCalledWith({ mode: "off", domain: null });
    expect(onUndone).toHaveBeenCalledWith({ mode: "off", domain: null });
    expect(toast.calls.success).toHaveLength(2);
  });

  it("a THROWN Undo toasts common.actionCrashed and never calls onUndone — the toast button is never silently inert (mutation: let the Undo's own setReplies throw escape unhandled → this test's microtask would never resolve/assert, FAILS)", async () => {
    const toast = fakeToast();
    const onUndone = vi.fn();
    const setReplies = vi.fn()
      .mockResolvedValueOnce({ ok: true, previous: { mode: "off", domain: null } })
      .mockRejectedValueOnce(new Error("expired session"));
    await applyReplies({ setReplies, toast, onApplied: vi.fn(), onUndone }, { mode: "bis", domain: null });
    const undo = (toast.calls.success[0]![1] as { action: { onClick: () => void } }).action;
    undo.onClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUndone).not.toHaveBeenCalled();
    expect(toast.calls.error).toEqual([[m["common.actionCrashed"]]]);
  });
});

describe("probeDns — the same guard for Check DNS alone", () => {
  it("answers the server's result on success", async () => {
    const toast = fakeToast();
    const checkDns = vi.fn().mockResolvedValue({ ok: true });
    expect(await probeDns(checkDns, "reply.rio.com", toast)).toEqual({ ok: true });
  });

  it("a THROWN checkDns toasts common.actionCrashed and answers null (mutation: drop the catch → FAILS, the promise rejects instead of resolving null)", async () => {
    const toast = fakeToast();
    const checkDns = vi.fn().mockRejectedValue(new Error("stale deployment"));
    expect(await probeDns(checkDns, "reply.rio.com", toast)).toBeNull();
    expect(toast.calls.error).toEqual([[m["common.actionCrashed"]]]);
  });
});
