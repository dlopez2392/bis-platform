import { describe, it, expect, vi } from "vitest";
import { aiCardHandlers } from "./ai-card-handlers";

/** Rule 6: Save and the global switch run at once; the toast carries Undo. Words read in both languages. */
function deps(locale: "en" | "es", o: Partial<Parameters<typeof aiCardHandlers>[0]> = {}) {
  const said: { kind: string; text: string; undo?: string; onUndo?: () => void }[] = [];
  const toast = {
    success: (text: string, opts?: { action: { label: string; onClick: () => void } }) => { said.push({ kind: "ok", text, undo: opts?.action.label, onUndo: opts?.action.onClick }); },
    error: (text: string) => { said.push({ kind: "error", text }); },
  };
  const refresh = vi.fn();
  const save = vi.fn(async () => ({ ok: true as const, prior: { enabled: true, monthlyBudgetCents: 1000 }, wrote: { enabled: false, monthlyBudgetCents: 2500 } }));
  const undo = vi.fn(async () => ({ ok: true as const, prior: { enabled: false, monthlyBudgetCents: 2500 }, wrote: { enabled: true, monthlyBudgetCents: 1000 } }));
  const defaultSetGlobal = vi.fn(async () => ({ ok: true as const, prior: true }));
  const setGlobal = o.setGlobal ?? defaultSetGlobal;
  return { said, refresh, save, undo, setGlobal, h: aiCardHandlers({ locale, toast, refresh, save, undo, setGlobal, ...o }) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("aiCardHandlers.save", () => {
  it("saves, refreshes, and offers an Undo that writes back the prior values against what was written (mutation: undo with the new values -> FAILS)", async () => {
    const d = deps("en");
    expect(await d.h.save({ enabled: false, budget: "25" })).toBe(true);
    expect(d.save).toHaveBeenCalledWith({ enabled: false, budget: "25" });
    expect(d.refresh).toHaveBeenCalledTimes(1);
    expect(d.said[0]).toMatchObject({ kind: "ok", text: "Saved. This account's AI settings are updated.", undo: "Undo" });
    d.said[0]!.onUndo!();
    await settle();
    expect(d.undo).toHaveBeenCalledWith({ enabled: true, monthlyBudgetCents: 1000 }, { enabled: false, monthlyBudgetCents: 2500 });
    expect(d.said[1]).toEqual({ kind: "ok", text: "Put back the earlier AI settings.", undo: undefined, onUndo: undefined });
    expect(d.refresh).toHaveBeenCalledTimes(2);
  });

  it("a refusal says its sentence in the reader's language and refreshes nothing (mutation: toast the key itself -> FAILS)", async () => {
    const d = deps("es", { save: vi.fn(async () => ({ ok: false as const, error: "aiSettings.error.budget" as const })) });
    expect(await d.h.save({ enabled: true, budget: "abc" })).toBe(false);
    expect(d.said).toEqual([{ kind: "error", text: "Escriba una cantidad en dólares enteros de $0 a $1,000." }]);
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("a thrown action (a stale tab) says the card's own crash sentence, in usted (mutation: common.actionCrashed -> FAILS)", async () => {
    const d = deps("es", { save: vi.fn(async () => { throw new Error("stale"); }) });
    await d.h.save({ enabled: true, budget: "10" });
    expect(d.said).toEqual([{ kind: "error", text: "Algo salió mal. Vuelva a cargar la página e inténtelo de nuevo." }]);
  });
});

describe("aiCardHandlers.setGlobal", () => {
  it("turning off sends the typed word; its Undo turns AI back on, with the expected value the write made (mutation: drop confirm -> FAILS)", async () => {
    const d = deps("en");
    await d.h.setGlobal(false, "off");
    expect(d.setGlobal).toHaveBeenCalledWith({ enabled: false, confirm: "off" });
    expect(d.said[0]).toMatchObject({ kind: "ok", text: "Summaries, cards and suggestions are off in every account.", undo: "Undo" });
    d.said[0]!.onUndo!();
    await settle();
    expect(d.setGlobal).toHaveBeenLastCalledWith({ enabled: true, confirm: undefined, expected: false });
  });

  it("turning on is immediate, and its Undo turns AI off again with the reader's word and the expected value the write made (mutation: undo without the word -> FAILS)", async () => {
    const d = deps("es", { setGlobal: vi.fn(async () => ({ ok: true as const, prior: false })) });
    await d.h.setGlobal(true);
    expect(d.said[0]).toMatchObject({ kind: "ok", text: "Los resúmenes, las tarjetas y las sugerencias volvieron a encenderse en todas las cuentas.", undo: "Deshacer" });
    d.said[0]!.onUndo!();
    await settle();
    expect(d.setGlobal).toHaveBeenLastCalledWith({ enabled: false, confirm: "APAGAR", expected: true });
  });

  it("a wrong word says which word, in the reader's language", async () => {
    const d = deps("en", { setGlobal: vi.fn(async () => ({ ok: false as const, error: "aiSettings.global.wrongWord" as const })) });
    expect(await d.h.setGlobal(false, "of")).toBe(false);
    expect(d.said).toEqual([{ kind: "error", text: "Type OFF to turn off summaries, cards and suggestions everywhere." }]);
  });
});
