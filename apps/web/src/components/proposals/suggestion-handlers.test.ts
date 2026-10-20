import { describe, it, expect, vi } from "vitest";
import { runDecision, SUGGESTION_TOAST_MS, type SuggestionActionResult, type UndoResult } from "./suggestion-handlers";

/**
 * The pure sequencing behind a suggestion's Accept / Edit and accept / Discard (item 8b-1, P8): the
 * cancel-booking.ts shape, with the toast and the timer injected, so no DOM is needed. The toast lives
 * 10 seconds; the server's 2-minute Undo window is NOT the toast's life.
 */
function fakeToast() {
  let undo: (() => void) | null = null;
  return {
    toast: {
      success: vi.fn((_msg: unknown, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => {
        undo = (opts?.action as { onClick: () => void } | undefined)?.onClick ?? null;
        return "toast_1";
      }),
      error: vi.fn(() => "toast_err"),
      dismiss: vi.fn(),
    },
    clickUndo: () => undo?.(),
  };
}
function fakeSchedule() {
  const jobs: { fn: () => void; ms: number }[] = [];
  return { schedule: (fn: () => void, ms: number) => { jobs.push({ fn, ms }); }, jobs };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const labels = { undo: "Undo", crashed: "Something went wrong. Try again.", reload: "Reload", lang: "en" as const };
/** A toast's words as the handler hands them to sonner: an element carrying the reader's lang (design
 *  review I3), so a Spanish toast under <html lang="en"> is announced in a Spanish voice. */
const said = (text: string, lang: "en" | "es" = "en") => expect.objectContaining({ type: "span", props: { lang, children: text } });
const accepted: SuggestionActionResult = { ok: true, status: "accepted", toast: "Added to your to-do list" };

function deps(over: { act?: () => Promise<SuggestionActionResult>; undo?: () => Promise<UndoResult>; lang?: "en" | "es" } = {}) {
  const t = fakeToast();
  const s = fakeSchedule();
  const act = vi.fn(over.act ?? (async () => accepted));
  const undo = vi.fn(over.undo ?? (async (): Promise<UndoResult> => ({ ok: true, message: "Undone." })));
  return { t, s, act, undo, d: { act, undo, toast: t.toast as never, schedule: s.schedule, reload: () => {}, labels: { ...labels, lang: over.lang ?? "en" } } };
}

describe("runDecision", () => {
  it("a decision toasts its words with Undo for 10 seconds, and schedules that toast's dismissal at 10 seconds", async () => {
    const { t, s, d } = deps();
    expect(await runDecision(d)).toEqual({ ok: true });
    expect(SUGGESTION_TOAST_MS).toBe(10_000);
    expect(t.toast.success).toHaveBeenCalledTimes(1);
    expect(t.toast.success).toHaveBeenCalledWith(said("Added to your to-do list"), {
      action: { label: said("Undo"), onClick: expect.any(Function) },
      duration: 10_000,
    });
    expect(s.jobs.map((j) => j.ms)).toEqual([10_000]);
    s.jobs[0]!.fn();
    expect(t.toast.dismiss).toHaveBeenCalledWith("toast_1");
  });

  it("clicking Undo calls undo once (never the decision again) and toasts its message", async () => {
    const { t, d, act, undo } = deps();
    await runDecision(d);
    t.clickUndo();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledTimes(1);
    expect(t.toast.success).toHaveBeenLastCalledWith(said("Undone."));
    expect(t.toast.error).not.toHaveBeenCalled();
  });

  it("a second click on the same toast's Undo does nothing: undo runs once", async () => {
    const { t, d, undo } = deps();
    await runDecision(d);
    t.clickUndo();
    t.clickUndo();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(t.toast.success).toHaveBeenCalledTimes(2);
  });

  it("an Undo the server refuses is toasted as an error with its own words", async () => {
    const { t, d } = deps({ undo: async () => ({ ok: false, error: "Too late to undo here. Change it by hand." }) });
    await runDecision(d);
    t.clickUndo();
    await flush();
    expect(t.toast.error).toHaveBeenCalledWith(said("Too late to undo here. Change it by hand."));
    expect(t.toast.success).toHaveBeenCalledTimes(1);
  });

  it("an Undo that throws is toasted as the crash words", async () => {
    const { t, d } = deps({ undo: async () => { throw new Error("network"); } });
    await runDecision(d);
    t.clickUndo();
    await flush();
    expect(t.toast.error).toHaveBeenCalledWith(said(labels.crashed), { action: { label: said("Reload"), onClick: expect.any(Function) } });
  });

  it("a refused decision toasts its error, offers no Undo and hands the field back for the form", async () => {
    const { t, s, d } = deps({ act: async () => ({ ok: false, error: "Enter a phone number.", field: "value" }) });
    expect(await runDecision(d)).toEqual({ ok: false, error: "Enter a phone number.", field: "value" });
    expect(t.toast.error).toHaveBeenCalledWith(said("Enter a phone number."));
    expect(t.toast.success).not.toHaveBeenCalled();
    expect(s.jobs).toEqual([]);
  });

  it("a Spanish reader's toasts, its Undo and Undo's answer all carry lang=\"es\" (design review I3; mutation: hand sonner the bare string -> FAILS)", async () => {
    const { t, d } = deps({
      lang: "es",
      act: async () => ({ ok: true, status: "accepted", toast: "Agregado a sus pendientes" }),
      undo: async () => ({ ok: true, message: "Se deshizo." }),
    });
    await runDecision({ ...d, labels: { ...d.labels, undo: "Deshacer" } });
    expect(t.toast.success).toHaveBeenCalledWith(said("Agregado a sus pendientes", "es"),
      expect.objectContaining({ action: expect.objectContaining({ label: said("Deshacer", "es") }) }));
    t.clickUndo();
    await flush();
    expect(t.toast.success).toHaveBeenLastCalledWith(said("Se deshizo.", "es"));
  });

  it("a decision that throws toasts the crash words and offers no Undo", async () => {
    const { t, s, d } = deps({ act: async () => { throw new Error("boom"); } });
    expect(await runDecision(d)).toEqual({ ok: false, error: labels.crashed });
    expect(t.toast.error).toHaveBeenCalledWith(said(labels.crashed), { action: { label: said("Reload"), onClick: expect.any(Function) } });
    expect(t.toast.success).not.toHaveBeenCalled();
    expect(s.jobs).toEqual([]);
  });
});

describe("runDecision: a client-side rejection says reload (8b-1 follow-up 1)", () => {
  const reloadLabels = { undo: "Undo", crashed: "That didn't reach us. Reload the page, then check before trying again.", reload: "Reload", lang: "es" as const };
  it("a decision that throws offers a Reload action in the reader's lang, and clicking it calls the injected reload (mutation: drop the action -> FAILS)", async () => {
    const reload = vi.fn();
    const { t, d } = deps({ act: async () => { throw new Error("Failed to fetch"); } });
    await runDecision({ ...d, labels: reloadLabels, reload });
    expect(t.toast.error).toHaveBeenCalledWith(said(reloadLabels.crashed, "es"), {
      action: { label: said("Reload", "es"), onClick: expect.any(Function) },
    });
    const opts = (t.toast.error.mock.calls[0] as unknown[])[1] as { action: { onClick: () => void } };
    expect(reload).not.toHaveBeenCalled();
    opts.action.onClick();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("an Undo that throws offers the same Reload action (mutation: drop it on the undo path -> FAILS)", async () => {
    const reload = vi.fn();
    const { t, d } = deps({ undo: async () => { throw new Error("Failed to fetch"); } });
    await runDecision({ ...d, labels: reloadLabels, reload });
    t.clickUndo();
    await flush();
    const call = t.toast.error.mock.calls.at(-1) as unknown[];
    expect(call[0]).toEqual(said(reloadLabels.crashed, "es"));
    (call[1] as { action: { onClick: () => void } }).action.onClick();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("a refusal the server answered is NOT a reload: its own words, no action", async () => {
    const reload = vi.fn();
    const { t, d } = deps({ act: async () => ({ ok: false, error: "That may not have gone through. Check before trying again." }) });
    await runDecision({ ...d, labels: reloadLabels, reload });
    expect(t.toast.error).toHaveBeenCalledWith(said("That may not have gone through. Check before trying again.", "es"));
    expect((t.toast.error.mock.calls[0] as unknown[]).length).toBe(1);
  });
});
