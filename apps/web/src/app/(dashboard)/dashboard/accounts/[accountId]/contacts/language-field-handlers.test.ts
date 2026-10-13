import { describe, it, expect, vi } from "vitest";
import { chooseLanguage, keepLanguage, type LanguageFieldDeps } from "./language-field-handlers";

const PRIOR = { language: "es" as const, source: "booking" as const, setAt: "2026-10-03T15:00:00+00:00" };
const WRITTEN = { language: "en" as const, source: "staff" as const, setAt: "2026-10-13T12:00:00+00:00" };
/** A plain, synchronous stand-in for the component's ref-backed guard (language-field.tsx). */
function makeGuard() {
  let v = false;
  return { get: () => v, set: (x: boolean) => { v = x; } };
}
function deps(over: Partial<LanguageFieldDeps> = {}) {
  const toast = { success: vi.fn(), error: vi.fn() };
  const d: LanguageFieldDeps = {
    set: vi.fn(async () => ({ ok: true as const, prior: PRIOR, written: WRITTEN })),
    restore: vi.fn(async () => ({ ok: true as const })),
    keep: vi.fn(async () => ({ ok: true as const })),
    toast, onChanged: vi.fn(), locale: "en", pending: makeGuard(), ...over,
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

describe("review I2: a rejected call never throws, it toasts the save-failed message", () => {
  it("a rejected set (mutation: drop the catch around d.set -> unhandled rejection, FAILS)", async () => {
    const d = deps({ set: vi.fn(async () => { throw new Error("network down"); }) });
    await expect(chooseLanguage(d, "en")).resolves.toBeUndefined();
    expect(d.toast.error).toHaveBeenCalledWith("Couldn't change the language. Try again.");
    expect(d.onChanged).not.toHaveBeenCalled();
  });

  it("a rejected restore, via the Undo toast's own onClick (mutation: drop the catch around d.restore -> unhandled rejection, FAILS)", async () => {
    const d = deps({ restore: vi.fn(async () => { throw new Error("network down"); }) });
    await chooseLanguage(d, "en");
    const opts = (d.toast.success as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    opts.action.onClick();
    await vi.waitFor(() => expect(d.toast.error).toHaveBeenCalledWith("Couldn't change the language. Try again."));
    expect(d.onChanged).toHaveBeenCalledTimes(1); // the original choice only, never the failed Undo
  });

  it("a rejected keep (mutation: drop the catch around d.keep -> unhandled rejection, FAILS)", async () => {
    const d = deps({ keep: vi.fn(async () => { throw new Error("network down"); }) });
    await expect(keepLanguage(d)).resolves.toBeUndefined();
    expect(d.toast.error).toHaveBeenCalledWith("Couldn't change the language. Try again.");
    expect(d.onChanged).not.toHaveBeenCalled();
  });
});

describe("review I3: one write on this field at a time (Select, Switch, Keep, Undo share the guard)", () => {
  it("a second choice made while the first is still in flight is ignored (mutation: drop the guard -> set called twice, FAILS)", async () => {
    let resolve!: (v: Awaited<ReturnType<LanguageFieldDeps["set"]>>) => void;
    const d = deps({ set: vi.fn(() => new Promise<Awaited<ReturnType<LanguageFieldDeps["set"]>>>((res) => { resolve = res; })) });
    const p1 = chooseLanguage(d, "en");
    const p2 = chooseLanguage(d, "es"); // fired before p1's `set` has settled
    resolve({ ok: true, prior: PRIOR, written: WRITTEN });
    await Promise.all([p1, p2]);
    expect(d.set).toHaveBeenCalledTimes(1);
  });

  it("the guard releases on success, so a LATER choice (not overlapping) still runs", async () => {
    const d = deps();
    await chooseLanguage(d, "en");
    await chooseLanguage(d, "es");
    expect(d.set).toHaveBeenCalledTimes(2);
  });

  it("the guard releases on a refused save too, so the next attempt is not locked out forever", async () => {
    const d = deps({ set: vi.fn(async () => ({ ok: false as const, error: "Couldn't change the language. Try again." })) });
    await chooseLanguage(d, "en");
    await chooseLanguage(d, "es");
    expect(d.set).toHaveBeenCalledTimes(2);
  });

  it("Keep is locked out by a choice already in flight (one guard, shared across the field's controls)", async () => {
    let resolve!: (v: Awaited<ReturnType<LanguageFieldDeps["set"]>>) => void;
    const d = deps({ set: vi.fn(() => new Promise<Awaited<ReturnType<LanguageFieldDeps["set"]>>>((res) => { resolve = res; })) });
    const p1 = chooseLanguage(d, "en");
    const p2 = keepLanguage(d);
    resolve({ ok: true, prior: PRIOR, written: WRITTEN });
    await Promise.all([p1, p2]);
    expect(d.keep).not.toHaveBeenCalled();
  });
});
