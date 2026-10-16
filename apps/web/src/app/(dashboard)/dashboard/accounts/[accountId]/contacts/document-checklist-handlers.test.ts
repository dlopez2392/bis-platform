import { describe, it, expect, vi, beforeEach } from "vitest";

/** One call log for the actions, the toasts, reload and refresh, so the ORDER is asserted too. */
const calls = vi.hoisted(() => [] as string[]);
const toast = vi.hoisted(() => ({
  success: vi.fn((msg: string) => { calls.push(`toast.success:${msg}`); }),
  error: vi.fn((msg: string) => { calls.push(`toast.error:${msg}`); }),
}));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
  skipDocumentRequirementAction: vi.fn(), undoSkipDocumentRequirementAction: vi.fn(),
  unskipDocumentRequirementAction: vi.fn(), undoUnskipDocumentRequirementAction: vi.fn(),
}));
vi.mock("./document-requirements-actions", () => actions);
const { checklistHandlers } = await import("./document-checklist-handlers");

const SKIP = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-16T15:00:00.123456+00:00";
const undoOf = () => (toast.success.mock.calls.at(-1) as unknown as [string, { action: { label: string; onClick: () => void } }])[1].action;
const flush = () => new Promise((r) => setTimeout(r, 0));
const make = (locale: "en" | "es" = "en", inFlight = new Set<string>()) => {
  const reload = vi.fn(() => { calls.push("reload"); });
  const refresh = vi.fn(() => { calls.push("refresh"); });
  return { reload, refresh, h: checklistHandlers({ accountId: "acc", contactId: "ct1", locale, reload, refresh, inFlight }) };
};

beforeEach(() => { vi.clearAllMocks(); calls.length = 0; });

describe("Not needed and Needed again run at once with an Undo (rule 6; S-07 2c)", () => {
  it("skip calls the action, re-reads the list and refreshes the page once each, then toasts with an Undo that undoes THAT skip (mutation: Undo with no id -> FAILS)", async () => {
    actions.skipDocumentRequirementAction.mockImplementation(async () => { calls.push("skip"); return { ok: true, skipId: SKIP }; });
    actions.undoSkipDocumentRequirementAction.mockImplementation(async () => { calls.push("undo"); return { ok: true }; });
    const { h, reload, refresh } = make();
    await h.skip("insurance");
    expect(actions.skipDocumentRequirementAction).toHaveBeenCalledWith("acc", "ct1", "insurance");
    expect(calls).toEqual(["skip", "reload", "refresh", "toast.success:Insurance isn't needed for this customer."]);
    expect(undoOf().label).toBe("Undo");
    undoOf().onClick();
    await flush();
    expect(actions.undoSkipDocumentRequirementAction).toHaveBeenCalledWith("acc", SKIP);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("unskip toasts 'needed again' whose Undo carries the INSTANT the action answered (mutation: new Date().toISOString() -> FAILS)", async () => {
    actions.unskipDocumentRequirementAction.mockResolvedValue({ ok: true, skipId: SKIP, unskippedAt: AT });
    actions.undoUnskipDocumentRequirementAction.mockResolvedValue({ ok: true });
    const { h, reload, refresh } = make();
    await h.unskip("insurance");
    expect(actions.unskipDocumentRequirementAction).toHaveBeenCalledWith("acc", "ct1", "insurance");
    expect(toast.success.mock.calls[0]![0]).toBe("Insurance is needed again.");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    undoOf().onClick();
    await flush();
    expect(actions.undoUnskipDocumentRequirementAction).toHaveBeenCalledWith("acc", SKIP, AT);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("a refusal toasts its key's words and re-reads nothing (mutation: reload on a refusal -> FAILS)", async () => {
    actions.skipDocumentRequirementAction.mockResolvedValue({ ok: false, error: "documents.checklist.skipRole" });
    const { h, reload, refresh } = make();
    await h.skip("id");
    expect(toast.error).toHaveBeenCalledWith("Only an Owner or Staff can change a customer's list.");
    actions.unskipDocumentRequirementAction.mockResolvedValue({ ok: false, error: "documents.checklist.refused" });
    await h.unskip("id");
    expect(toast.error).toHaveBeenCalledWith("We couldn't change that. Reload the page.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("an Undo that lost the race says so and re-reads nothing more", async () => {
    actions.skipDocumentRequirementAction.mockResolvedValue({ ok: true, skipId: SKIP });
    actions.undoSkipDocumentRequirementAction.mockResolvedValue({ ok: false, error: "documents.checklist.changed" });
    const { h, reload } = make();
    await h.skip("id");
    undoOf().onClick();
    await flush();
    expect(toast.error).toHaveBeenCalledWith("Someone changed this first. Reload to see it.");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a thrown action toasts the checklist's own usted sentence, never common.actionCrashed's tú (M9; mutation: toast common.actionCrashed -> the Spanish literal FAILS)", async () => {
    actions.skipDocumentRequirementAction.mockRejectedValue(new Error("stale deployment"));
    const { h, reload } = make("es");
    await h.skip("id");
    expect(toast.error).toHaveBeenCalledWith("Eso no se completó. Puede que esta página esté desactualizada: vuelva a cargarla e intente de nuevo.");
    expect(reload).not.toHaveBeenCalled();
    actions.undoUnskipDocumentRequirementAction.mockRejectedValue(new Error("stale deployment"));
    actions.unskipDocumentRequirementAction.mockResolvedValue({ ok: true, skipId: SKIP, unskippedAt: AT });
    const en = make("en");
    await en.h.unskip("id");
    undoOf().onClick();
    await flush();
    expect(toast.error).toHaveBeenLastCalledWith("That didn't go through. This page may be out of date: reload it and try again.");
  });

  it("a second click while the first is in flight does nothing (inFlight keyed skip:<category>; mutation: drop the lock -> FAILS)", async () => {
    let release!: (v: unknown) => void;
    actions.skipDocumentRequirementAction.mockImplementation(() => new Promise((r) => { release = r; }));
    const inFlight = new Set<string>();
    const { h } = make("en", inFlight);
    const first = h.skip("insurance");
    expect(inFlight.has("skip:insurance")).toBe(true);
    await h.skip("insurance");
    await h.unskip("insurance");
    expect(actions.skipDocumentRequirementAction).toHaveBeenCalledTimes(1);
    expect(actions.unskipDocumentRequirementAction).not.toHaveBeenCalled();
    release({ ok: true, skipId: SKIP });
    await first;
    expect(inFlight.size).toBe(0);
  });

  it("Spanish toasts (literals; mutation: an English category word -> FAILS)", async () => {
    actions.skipDocumentRequirementAction.mockResolvedValue({ ok: true, skipId: SKIP });
    actions.unskipDocumentRequirementAction.mockResolvedValue({ ok: true, skipId: SKIP, unskippedAt: AT });
    const { h } = make("es");
    await h.skip("insurance");
    expect(toast.success.mock.calls[0]![0]).toBe("Seguro no hace falta para este cliente.");
    expect(undoOf().label).toBe("Deshacer");
    await h.unskip("insurance");
    expect(toast.success.mock.calls[1]![0]).toBe("Seguro hace falta otra vez.");
  });
});
