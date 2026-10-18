import { describe, it, expect, vi, beforeEach } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { requiredListHandlers } = await import("./required-documents-handlers");

const flush = () => new Promise((r) => setTimeout(r, 0));

/** The {label, onClick} of the most recent toast.success call. */
const undoOf = () =>
  (toast.success.mock.calls.at(-1) as unknown as [string, { action: { label: string; onClick: () => void } }])[1].action;

beforeEach(() => { vi.clearAllMocks(); });

describe("the Owner card's Save and Undo (S-07 3a, spec 3.3; plan deviation 9 and 11)", () => {
  it("saves, toasts with an Undo that restores the previous list as a compare-and-set (mutation: swap undo's arguments -> FAILS)", async () => {
    const save = vi.fn(async () => ({ ok: true as const, list: ["id", "insurance"] }));
    const undo = vi.fn(async () => ({ ok: true as const }));
    const onChange = vi.fn();
    const h = requiredListHandlers({ locale: "en", save, undo, onChange });
    await h.submit(new FormData(), ["id"]);
    expect(onChange).toHaveBeenCalledWith(["id", "insurance"]);
    expect(toast.success).toHaveBeenCalledWith(
      "Saved. Each customer's Documents card shows the list.",
      { action: { label: "Undo", onClick: expect.any(Function) } },
    );
    undoOf().onClick();
    await flush();
    expect(undo).toHaveBeenCalledWith(["id", "insurance"], ["id"]);
    expect(onChange).toHaveBeenCalledWith(["id"]);
    expect(toast.success).toHaveBeenLastCalledWith("Put back the list you had.");
  });

  it("an Undo that lost the race says so and does not change the picked list again", async () => {
    const save = vi.fn(async () => ({ ok: true as const, list: ["id"] }));
    const undo = vi.fn(async () => ({ ok: false as const, error: "documents.required.changed" as const }));
    const onChange = vi.fn();
    const h = requiredListHandlers({ locale: "en", save, undo, onChange });
    await h.submit(new FormData(), []);
    onChange.mockClear();
    undoOf().onClick();
    await flush();
    expect(toast.error).toHaveBeenCalledWith("Someone changed the list since. Reload the page to see it.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a save refusal toasts the card's OWN sentence, never the action's English error, and never calls onChange; a thrown save toasts the crash sentence", async () => {
    const onChange = vi.fn();
    const save1 = vi.fn(async () => ({ ok: false as const, error: "anything in English" }));
    const h1 = requiredListHandlers({ locale: "en", save: save1, undo: vi.fn(), onChange });
    await h1.submit(new FormData(), ["id"]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the list. Try again.");
    expect(onChange).not.toHaveBeenCalled();

    const save2 = vi.fn(async () => { throw new Error("stale deployment"); });
    const h2 = requiredListHandlers({ locale: "en", save: save2, undo: vi.fn(), onChange });
    await h2.submit(new FormData(), ["id"]);
    expect(toast.error).toHaveBeenCalledWith("That didn't finish. This page may be out of date: reload it and try again.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("an empty saved list toasts 'The list is off.'", async () => {
    const save = vi.fn(async () => ({ ok: true as const, list: [] }));
    const h = requiredListHandlers({ locale: "en", save, undo: vi.fn(), onChange: vi.fn() });
    await h.submit(new FormData(), ["id"]);
    expect(toast.success).toHaveBeenCalledWith("Saved. The list is off.", expect.anything());
  });

  it("Spanish (literals; mutation: an English literal -> FAILS)", async () => {
    const save = vi.fn(async () => ({ ok: true as const, list: ["id", "insurance"] }));
    const h = requiredListHandlers({ locale: "es", save, undo: vi.fn(), onChange: vi.fn() });
    await h.submit(new FormData(), ["id"]);
    expect(toast.success).toHaveBeenCalledWith(
      "Guardado. La tarjeta de Documentos de cada cliente muestra la lista.",
      { action: { label: "Deshacer", onClick: expect.any(Function) } },
    );
    const save2 = vi.fn(async () => { throw new Error("stale deployment"); });
    const h2 = requiredListHandlers({ locale: "es", save: save2, undo: vi.fn(), onChange: vi.fn() });
    await h2.submit(new FormData(), ["id"]);
    expect(toast.error).toHaveBeenCalledWith(
      "Eso no se completó. Puede que esta página esté desactualizada: vuelva a cargarla e intente de nuevo.",
    );
  });
});
