import { describe, it, expect, vi } from "vitest";
import { runAddNeverLog, runRemoveNeverLog, type NeverLogDeps } from "./never-log-handlers";

const E = { id: "n1", pattern: "supplier.com", kind: "domain" as const };
function deps(over: Partial<NeverLogDeps> = {}) {
  const toast = { success: vi.fn(), error: vi.fn() };
  const d: NeverLogDeps = {
    add: vi.fn(async () => ({ ok: true as const, entry: E })), remove: vi.fn(async () => ({ ok: true as const, removed: E })),
    toast, locale: "en", onAdded: vi.fn(), onRemoved: vi.fn(), onInlineError: vi.fn(), ...over,
  };
  return { d, toast };
}
const undoOf = (toast: { success: ReturnType<typeof vi.fn> }) => (toast.success.mock.calls[0]![1] as { action: { label: string; onClick: () => void } }).action;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("runAddNeverLog (rule 6: at once, with Undo)", () => {
  it("adds, toasts with an Undo that removes the new entry (mutation: Undo calls add → FAILS)", async () => {
    const { d, toast } = deps();
    expect(await runAddNeverLog(d, "supplier.com")).toBe(true);
    expect(d.onAdded).toHaveBeenCalledWith(E);
    expect(toast.success.mock.calls[0]![0]).toBe("Mail from supplier.com will never be saved.");
    expect(undoOf(toast).label).toBe("Undo");
    undoOf(toast).onClick(); await flush();
    expect(d.remove).toHaveBeenCalledWith("n1");
    expect(d.onRemoved).toHaveBeenCalledWith("n1");
    expect(toast.success.mock.calls[1]![0]).toBe("Back as it was.");
  });

  it("in Spanish, the same toasts in Spanish (mutation: hard-code 'en' → FAILS)", async () => {
    const { d, toast } = deps({ locale: "es" });
    await runAddNeverLog(d, "supplier.com");
    expect(toast.success.mock.calls[0]![0]).toBe("El correo de supplier.com nunca se guardará.");
    expect(undoOf(toast).label).toBe("Deshacer");
  });

  it("invalid, duplicate and full are inline messages, failed a toast; nothing is added (mutation: toast the duplicate → FAILS)", async () => {
    for (const [error, inline] of [["invalid", "Enter an address like name@example.com or a domain like example.com."], ["duplicate", "Already on the list."], ["full", "The list is full (200). Remove one to add another."]] as const) {
      const { d, toast } = deps({ add: vi.fn(async () => ({ ok: false as const, error })) });
      expect(await runAddNeverLog(d, "x")).toBe(false);
      expect(d.onInlineError).toHaveBeenLastCalledWith(inline);
      expect(toast.error).not.toHaveBeenCalled();
      expect(d.onAdded).not.toHaveBeenCalled();
    }
    const { d, toast } = deps({ add: vi.fn(async () => ({ ok: false as const, error: "failed" as const })) });
    await runAddNeverLog(d, "x");
    expect(toast.error).toHaveBeenCalledWith("That didn't save. Try again.");
  });

  it("a THROWN action toasts common.actionCrashed, and so does a thrown Undo (part 1 lesson; mutation: no catch → the promise rejects, FAILS)", async () => {
    const { d, toast } = deps({ add: vi.fn(async () => { throw new Error("stale deploy"); }) });
    expect(await runAddNeverLog(d, "x")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("That didn't go through — this page may be out of date. Reload it and try again.");
    const two = deps({ remove: vi.fn(async () => { throw new Error("x"); }) });
    await runAddNeverLog(two.d, "supplier.com");
    undoOf(two.toast).onClick(); await flush();
    expect(two.toast.error).toHaveBeenCalledWith("That didn't go through — this page may be out of date. Reload it and try again.");
    expect(two.d.onRemoved).not.toHaveBeenCalled();
  });
});

describe("runRemoveNeverLog", () => {
  it("removes, toasts with an Undo that adds the same pattern back (mutation: Undo re-adds by id → FAILS)", async () => {
    const { d, toast } = deps();
    expect(await runRemoveNeverLog(d, E)).toBe(true);
    expect(d.onRemoved).toHaveBeenCalledWith("n1");
    expect(toast.success.mock.calls[0]![0]).toBe("supplier.com is off the list.");
    undoOf(toast).onClick(); await flush();
    expect(d.add).toHaveBeenCalledWith("supplier.com");
    expect(d.onAdded).toHaveBeenCalledWith(E);
  });

  it("an entry someone else already removed leaves the list as the server says and toasts no Undo (mutation: offer Undo on removed null → FAILS)", async () => {
    const { d, toast } = deps({ remove: vi.fn(async () => ({ ok: true as const, removed: null })) });
    expect(await runRemoveNeverLog(d, E)).toBe(true);
    expect(d.onRemoved).toHaveBeenCalledWith("n1");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
