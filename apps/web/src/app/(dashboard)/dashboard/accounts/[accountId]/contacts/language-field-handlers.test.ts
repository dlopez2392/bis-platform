import { describe, it, expect, vi } from "vitest";
import { chooseLanguage, keepLanguage, type LanguageFieldDeps } from "./language-field-handlers";

const PRIOR = { language: "es" as const, source: "booking" as const, setAt: "2026-10-03T15:00:00+00:00" };
const WRITTEN = { language: "en" as const, source: "staff" as const, setAt: "2026-10-13T12:00:00+00:00" };
function deps(over: Partial<LanguageFieldDeps> = {}) {
  const toast = { success: vi.fn(), error: vi.fn() };
  const d: LanguageFieldDeps = {
    set: vi.fn(async () => ({ ok: true as const, prior: PRIOR, written: WRITTEN })),
    restore: vi.fn(async () => ({ ok: true as const })),
    keep: vi.fn(async () => ({ ok: true as const })),
    toast, onChanged: vi.fn(), locale: "en", ...over,
  };
  return d;
}

describe("the Language line's handlers (S-09 §8.3, rule 6)", () => {
  it("a choice saves at once, refreshes, and toasts with an Undo that restores the PRIOR triple (mutation: Undo re-sets the new language -> FAILS)", async () => {
    const d = deps();
    await chooseLanguage(d, "en");
    expect(d.set).toHaveBeenCalledWith("en");
    expect(d.onChanged).toHaveBeenCalledTimes(1);
    const [text, opts] = (d.toast.success as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(text).toBe("Language set to English.");
    expect(opts.action.label).toBe("Undo");
    opts.action.onClick();
    await vi.waitFor(() => expect(d.restore).toHaveBeenCalledWith(PRIOR, WRITTEN));
    await vi.waitFor(() => expect(d.onChanged).toHaveBeenCalledTimes(2));
  });

  it("the toast speaks the reader's language and names the endonym", async () => {
    const d = deps({ locale: "es" });
    await chooseLanguage(d, "es");
    expect((d.toast.success as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("Idioma cambiado a Español.");
  });

  it("a refused save toasts its error and offers no Undo (mutation: toast success anyway -> FAILS)", async () => {
    const d = deps({ set: vi.fn(async () => ({ ok: false as const, error: "Couldn't change the language. Try again." })) });
    await chooseLanguage(d, "en");
    expect(d.toast.error).toHaveBeenCalledWith("Couldn't change the language. Try again.");
    expect(d.toast.success).not.toHaveBeenCalled();
    expect(d.onChanged).not.toHaveBeenCalled();
  });

  it("Keep toasts without an Undo: nothing about the customer changed (mutation: add an action -> FAILS)", async () => {
    const d = deps();
    await keepLanguage(d);
    expect(d.keep).toHaveBeenCalledTimes(1);
    expect(d.toast.success).toHaveBeenCalledWith("We'll ask again if a newer call, booking or form says otherwise.");
    expect(d.onChanged).toHaveBeenCalledTimes(1);
  });
});
