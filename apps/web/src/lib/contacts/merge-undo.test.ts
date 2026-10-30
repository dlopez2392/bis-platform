import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-006 part 1 (plan Tasks 10-11, fix round, findings #1-#3): `runUndoMerge` is the ONE place a
 * merge's own Undo runs — the compare screen's toast action (merge/merge-screen.tsx) and the
 * timeline row's "Undo merge" button ([contactId]/merge-undo.tsx) both call it, so there is exactly
 * one place that can get "which name" or "which error key needs a value" wrong.
 */
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { runUndoMerge, fieldLabel } = await import("./merge-undo");

beforeEach(() => { toasts.success.mockReset(); toasts.error.mockReset(); });

describe("runUndoMerge: always names the OTHER record, never the kept one (finding #1)", () => {
  it("success toasts contacts.merge.undone naming otherName, and calls onDone", async () => {
    const undoAction = vi.fn(async () => ({ ok: true as const, keptNew: 0, keptEdits: [] }));
    const onDone = vi.fn();
    await runUndoMerge(undoAction, 77, "Jose Garcia", "en", onDone);
    expect(toasts.success).toHaveBeenCalledWith("Merge undone. Jose Garcia is back as their own record.", undefined);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("names what arrived since and what stayed changed, naming otherName in both lines", async () => {
    const undoAction = vi.fn(async () => ({ ok: true as const, keptNew: 2, keptEdits: ["first_name", "phone"] }));
    await runUndoMerge(undoAction, 1, "Jose Garcia", "en", vi.fn());
    const [, opts] = toasts.success.mock.calls[0]!;
    expect(opts.description).toContain("2 things that arrived after the merge stay with Jose Garcia.");
    expect(opts.description).toContain("Kept what was changed after the merge: first name and phone number.");
  });
});

describe("runUndoMerge: every errorKey it can receive renders with NO raw '{' left (finding #2)", () => {
  it.each(["contacts.merge.undoExpired", "contacts.merge.undoLater", "contacts.merge.undoFailed"] as const)(
    "%s never leaves a raw placeholder (mutation: call t() with no values -> the undoLater case FAILS, since only it carries {name})",
    async (errorKey) => {
      const undoAction = vi.fn(async () => ({ ok: false as const, errorKey }));
      await runUndoMerge(undoAction, 1, "Jose Garcia", "en", vi.fn());
      expect(toasts.error).toHaveBeenCalledTimes(1);
      const [message] = toasts.error.mock.calls[0]!;
      expect(message).not.toContain("{");
    },
  );

  it("undoLater actually names the other record in its own words (not just absence of '{')", async () => {
    const undoAction = vi.fn(async () => ({ ok: false as const, errorKey: "contacts.merge.undoLater" as const }));
    await runUndoMerge(undoAction, 1, "Jose Garcia", "en", vi.fn());
    expect(toasts.error).toHaveBeenCalledWith(
      "This merge can't be undone yet: Jose Garcia was merged again since. Undo the newer merge first.",
    );
  });
});

describe("runUndoMerge: a rejected undoAction resolves anyway (finding #3)", () => {
  it("a throw toasts contacts.merge.undoFailed, never an unhandled rejection, and never calls onDone (mutation: drop the try/catch -> this rejects instead of resolving, FAILS)", async () => {
    const undoAction = vi.fn(async () => { throw new Error("down"); });
    const onDone = vi.fn();
    await expect(runUndoMerge(undoAction, 1, "Jose Garcia", "en", onDone)).resolves.toBeUndefined();
    expect(toasts.error).toHaveBeenCalledWith("Couldn't undo the merge. Nothing changed. Try again.");
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("fieldLabel: the one field-noun function both callers share", () => {
  it("names a plain field and a custom one, in both languages", () => {
    expect(fieldLabel("phone", "en")).toBe("phone number");
    expect(fieldLabel("phone", "es")).toBe("el teléfono");
    expect(fieldLabel("custom.favoriteColor", "en")).toBe("“favoriteColor” field");
  });
});
