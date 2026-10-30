import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-006 part 1 (plan Tasks 10-11, fix round): `runUndoMerge` is the ONE place a merge's own Undo runs
 * — the compare screen's toast action (merge/merge-screen.tsx) and the timeline row's "Undo merge"
 * button ([contactId]/merge-undo.tsx) both call it, so there is exactly one place that can get "which
 * name" or "which error key needs a value" wrong.
 *
 * Second fix round (finding #1): `otherName` and `keptName` are two DIFFERENT people here on purpose
 * ("Jose Garcia" and "Maria Garcia") — a mutation that swapped them, or that used the same name for
 * both, could not be caught by a test that only ever gave `runUndoMerge` one name.
 */
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { runUndoMerge, fieldLabel } = await import("./merge-undo");

const NAMES = { otherName: "Jose Garcia", keptName: "Maria Garcia" };

beforeEach(() => { toasts.success.mockReset(); toasts.error.mockReset(); });

describe("runUndoMerge: contacts.merge.undone always names the OTHER record, never the kept one", () => {
  it("success toasts contacts.merge.undone naming otherName, and calls onDone", async () => {
    const undoAction = vi.fn(async () => ({ ok: true as const, keptNew: 0, keptEdits: [] }));
    const onDone = vi.fn();
    await runUndoMerge(undoAction, 77, NAMES, "en", onDone);
    expect(toasts.success).toHaveBeenCalledWith("Merge undone. Jose Garcia is back as their own record.", undefined);
    expect(toasts.success).not.toHaveBeenCalledWith(expect.stringContaining("Maria Garcia is back"), expect.anything());
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("runUndoMerge: undoneKept/undoneKeptOne name the KEPT record — the one that goes on receiving what arrives (fix round finding #1; mutation: pass names.otherName here instead -> FAILS)", () => {
  it("names what arrived since with keptName, and what stayed changed as its own line", async () => {
    const undoAction = vi.fn(async () => ({ ok: true as const, keptNew: 2, keptEdits: ["first_name", "phone"] }));
    await runUndoMerge(undoAction, 1, NAMES, "en", vi.fn());
    const [, opts] = toasts.success.mock.calls[0]!;
    expect(opts.description).toContain("2 things that arrived after the merge stay with Maria Garcia.");
    expect(opts.description).not.toContain("stay with Jose Garcia");
    expect(opts.description).toContain("Kept what was changed after the merge: first name and phone number.");
  });

  it("exactly one new thing uses the singular line, still naming keptName", async () => {
    const undoAction = vi.fn(async () => ({ ok: true as const, keptNew: 1, keptEdits: [] }));
    await runUndoMerge(undoAction, 1, NAMES, "en", vi.fn());
    const [, opts] = toasts.success.mock.calls[0]!;
    expect(opts.description).toContain("1 thing that arrived after the merge stays with Maria Garcia.");
  });
});

describe("runUndoMerge: every errorKey it can receive renders with NO raw '{' left (finding #2)", () => {
  it.each(["contacts.merge.undoExpired", "contacts.merge.undoLater", "contacts.merge.undoFailed"] as const)(
    "%s never leaves a raw placeholder (mutation: call t() with no values -> the undoLater case FAILS, since only it carries {name})",
    async (errorKey) => {
      const undoAction = vi.fn(async () => ({ ok: false as const, errorKey }));
      await runUndoMerge(undoAction, 1, NAMES, "en", vi.fn());
      expect(toasts.error).toHaveBeenCalledTimes(1);
      const [message] = toasts.error.mock.calls[0]!;
      expect(message).not.toContain("{");
    },
  );

  it("undoLater names the KEPT record — the record merged again since is the one that WAS kept by this merge (fix round finding #1; mutation: pass names.otherName -> FAILS)", async () => {
    const undoAction = vi.fn(async () => ({ ok: false as const, errorKey: "contacts.merge.undoLater" as const }));
    await runUndoMerge(undoAction, 1, NAMES, "en", vi.fn());
    expect(toasts.error).toHaveBeenCalledWith(
      "This merge can't be undone yet: Maria Garcia was merged again since. Undo the newer merge first.",
    );
    expect(toasts.error).not.toHaveBeenCalledWith(expect.stringContaining("Jose Garcia was merged again"));
  });
});

describe("runUndoMerge: a rejected undoAction resolves anyway (finding #3)", () => {
  it("a throw toasts contacts.merge.undoFailed, never an unhandled rejection, and never calls onDone (mutation: drop the try/catch -> this rejects instead of resolving, FAILS)", async () => {
    const undoAction = vi.fn(async () => { throw new Error("down"); });
    const onDone = vi.fn();
    await expect(runUndoMerge(undoAction, 1, NAMES, "en", onDone)).resolves.toBeUndefined();
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

  it("a custom field's own definition names its real label, not the raw key (fix round, carry-in 10; mutation: ignore customFieldNames -> FAILS)", () => {
    expect(fieldLabel("custom.favoriteColor", "en", { favoriteColor: "Favorite Color" })).toBe("“Favorite Color” field");
    expect(fieldLabel("custom.favoriteColor", "en", { favoriteColor: "Favorite Color" })).not.toContain("favoriteColor");
  });

  it("a custom key with no matching definition still falls back to the raw key", () => {
    expect(fieldLabel("custom.favoriteColor", "en", { otherKey: "Other" })).toBe("“favoriteColor” field");
  });

  // Fix round, carry-in 8: every group name 0106's app.merge_fields_of can report through keptEdits
  // (read-only from the migration's own c_groups array) resolves to a WORD, never its raw snake_case
  // key — the four named ones get their own words, everything else reads a generic word.
  it("last_language_signal, custom, archived_at and marketing_email_opted_out_at each get their own word, never the raw key (mutation: drop a FIELD_KEY entry -> that one FAILS)", () => {
    expect(fieldLabel("last_language_signal", "en")).toBe("the language hint");
    expect(fieldLabel("custom", "en")).toBe("the custom fields");
    expect(fieldLabel("archived_at", "en")).toBe("archived status");
    expect(fieldLabel("marketing_email_opted_out_at", "en")).toBe("the marketing email opt-out");
    for (const field of ["last_language_signal", "custom", "archived_at", "marketing_email_opted_out_at"]) {
      expect(fieldLabel(field, "en")).not.toBe(field);
    }
  });

  it("every OTHER group representative 0106 can report (dnd, reactivation_sent_at, language_hint_kept_at) reads the generic word, never the raw key (mutation: fall back to the raw field -> FAILS)", () => {
    for (const field of ["dnd", "reactivation_sent_at", "language_hint_kept_at"]) {
      expect(fieldLabel(field, "en")).toBe("another detail");
      expect(fieldLabel(field, "en")).not.toBe(field);
    }
  });

  it("the four named groups and the generic fallback both have Spanish words", () => {
    expect(fieldLabel("last_language_signal", "es")).toBe("el aviso de idioma");
    expect(fieldLabel("custom", "es")).toBe("los campos personalizados");
    expect(fieldLabel("archived_at", "es")).toBe("el estado de archivado");
    expect(fieldLabel("marketing_email_opted_out_at", "es")).toBe("la baja de correos de marketing");
    expect(fieldLabel("dnd", "es")).toBe("otro dato");
  });
});
