import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { makeTr } from "@/lib/record/copy";
import { ACT_TOAST_MS, runBookingUndo, runContactUndo, runFieldUndo, type ActToast, type RedoResult, type UndoResult } from "./undo-handlers";

/**
 * The Undo controls' sequencing (item 8c, plan Task 5 item 8), with no DOM: the toast, the refresh, the
 * navigation, the timer and the reload are injected (the `cancel-booking.ts` shape). Every word handed to
 * the toast is an element carrying the reader's `lang`, read back here as its text.
 */

const textOf = (node: unknown): string => {
  if (typeof node === "string") return node;
  if (isValidElement(node)) return String((node as ReactElement<{ children?: unknown }>).props.children);
  return String(node);
};
const langOf = (node: unknown): string | undefined =>
  isValidElement(node) ? (node as ReactElement<{ lang?: string }>).props.lang : undefined;

type Opts = { action?: { label: unknown; onClick: () => void }; duration?: number };
function harness() {
  const success = vi.fn<(m: unknown, o?: Opts) => string>(() => "t1");
  const error = vi.fn<(m: unknown, o?: Opts) => string>(() => "t2");
  const dismiss = vi.fn();
  const toast = { success, error, dismiss } as unknown as ActToast;
  const scheduled: [() => void, number][] = [];
  return {
    toast, success, error, dismiss, scheduled,
    schedule: (fn: () => void, ms: number) => { scheduled.push([fn, ms]); },
    refresh: vi.fn(), reload: vi.fn(), navigate: vi.fn(),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const en = makeTr("en");
const es = makeTr("es");

describe("runFieldUndo", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("runs at once, refreshes, and toasts what was put back with a 10-second Undo that puts Sofía's value back (mutation: drop the redo action -> FAILS)", async () => {
    const redo = vi.fn(async (): Promise<RedoResult> => ({ ok: true }));
    const ok = await runFieldUndo({ ...h, tr: en, field: "email", persona: "Lupe", undo: async () => ({ ok: true, control: "field" }), redo });
    expect(ok).toBe(true);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    const [msg, opts] = h.success.mock.calls[0]!;
    expect(textOf(msg)).toBe("Put back the email.");
    expect(langOf(msg)).toBe("en");
    expect(textOf(opts!.action!.label)).toBe("Undo");
    expect(opts!.duration).toBe(ACT_TOAST_MS);
    expect(ACT_TOAST_MS).toBe(10_000);
    expect(h.scheduled[0]![1]).toBe(10_000);
    h.scheduled[0]![0]();
    expect(h.dismiss).toHaveBeenCalledWith("t1");

    opts!.action!.onClick();
    opts!.action!.onClick();   // a double click sends ONE redo
    await flush();
    expect(redo).toHaveBeenCalledTimes(1);
    expect(textOf(h.success.mock.calls[1]![0])).toBe("Lupe's value is back.");
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("a redo refused says why in words", async () => {
    await runFieldUndo({ ...h, tr: en, field: "email", persona: "Lupe", undo: async () => ({ ok: true, control: "field" }), redo: async () => ({ ok: false, reason: "changed" }) });
    h.success.mock.calls[0]![1]!.action!.onClick();
    await flush();
    expect(textOf(h.error.mock.calls[0]![0])).toBe("This can't be undone any more: Changed since");
  });

  it("a refusal toasts the reason in the reader's language and does not refresh", async () => {
    const ok = await runFieldUndo({ ...h, tr: es, field: "el correo", persona: "Lupe", undo: async () => ({ ok: false, reason: "changed" }), redo: vi.fn() });
    expect(ok).toBe(false);
    expect(textOf(h.error.mock.calls[0]![0])).toBe("Ya no se puede deshacer: Cambió desde entonces");
    expect(langOf(h.error.mock.calls[0]![0])).toBe("es");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("a throw (the action unreachable) toasts the reload sentence with a Reload action", async () => {
    const ok = await runFieldUndo({ ...h, tr: en, field: "email", persona: "Lupe", undo: async () => { throw new Error("network"); }, redo: vi.fn() });
    expect(ok).toBe(false);
    const [msg, opts] = h.error.mock.calls[0]!;
    expect(textOf(msg)).toBe("That didn't work. Reload the page, then try again.");
    opts!.action!.onClick();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("an act already undone or gone says so; the reload sentence is only for an action that never answered (review M-4; mutation: toast the reload sentence -> FAILS)", async () => {
    const g = harness();
    await runFieldUndo({ ...g, tr: en, field: "email", persona: "Lupe", undo: async (): Promise<UndoResult> => ({ ok: false, reason: "notAvailable" }), redo: vi.fn() });
    expect(textOf(g.error.mock.calls[0]![0])).toBe("This can't be undone any more: It was already undone or removed");
    expect(g.error.mock.calls[0]![1]).toBeUndefined();
    const s = harness();
    await runFieldUndo({ ...s, tr: es, field: "el correo", persona: "Lupe", undo: async (): Promise<UndoResult> => ({ ok: false, reason: "notAvailable" }), redo: vi.fn() });
    expect(textOf(s.error.mock.calls[0]![0])).toBe("Ya no se puede deshacer: Ya se deshizo o ya no existe");
  });
  it("a typed name that did not match says so, in the reader's language (review M-4)", async () => {
    const g = harness();
    await runContactUndo({ ...g, tr: en, typedName: "Ana", listHref: "/x", undo: async (): Promise<UndoResult> => ({ ok: false, reason: "typedName" }) });
    expect(textOf(g.error.mock.calls[0]![0])).toBe("The name didn't match. Type it exactly as shown.");
    expect(g.navigate).not.toHaveBeenCalled();
    const s = harness();
    await runContactUndo({ ...s, tr: es, typedName: "Ana", listHref: "/x", undo: async (): Promise<UndoResult> => ({ ok: false, reason: "typedName" }) });
    expect(textOf(s.error.mock.calls[0]![0])).toBe("El nombre no coincide. Escríbalo tal como aparece.");
  });
  it("a redo of an act gone says so too", async () => {
    const g = harness();
    await runFieldUndo({ ...g, tr: en, field: "email", persona: "Lupe", undo: async () => ({ ok: true, control: "field" }), redo: async () => ({ ok: false, reason: "notAvailable" }) });
    g.success.mock.calls[0]![1]!.action!.onClick();
    await flush();
    expect(textOf(g.error.mock.calls[0]![0])).toBe("This can't be undone any more: It was already undone or removed");
  });
});

describe("runBookingUndo", () => {
  const cases: [UndoResult, string][] = [
    [{ ok: true, control: "booking", told: "yes" }, "Booking undone. Ana was emailed."],
    [{ ok: true, control: "booking", told: "no" }, "Booking undone. The email to Ana didn't go out."],
    [{ ok: true, control: "booking", told: "notAsked" }, "Booking undone."],
  ];
  it.each(cases)("%j toasts %s, refreshes, and offers no redo", async (result, words) => {
    const h = harness();
    const undo = vi.fn(async () => result);
    expect(await runBookingUndo({ ...h, tr: en, name: "Ana", notify: true, undo })).toBe(true);
    expect(undo).toHaveBeenCalledWith(true);
    const [msg, opts] = h.success.mock.calls[0]!;
    expect(textOf(msg)).toBe(words);
    expect(opts?.action).toBeUndefined();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
  it("passes the unticked box through", async () => {
    const h = harness();
    const undo = vi.fn(async (): Promise<UndoResult> => ({ ok: true, control: "booking", told: "notAsked" }));
    await runBookingUndo({ ...h, tr: en, name: "Ana", notify: false, undo });
    expect(undo).toHaveBeenCalledWith(false);
  });
  it("a refusal says why: the slot was taken", async () => {
    const h = harness();
    await runBookingUndo({ ...h, tr: en, name: "Ana", notify: true, undo: async () => ({ ok: false, reason: "timeTaken" }) });
    expect(textOf(h.error.mock.calls[0]![0])).toBe("This can't be undone any more: That time is taken now");
  });
});

describe("runContactUndo", () => {
  it("removed: toasts that the call stays, and goes to the contacts list", async () => {
    const h = harness();
    const undo = vi.fn(async (): Promise<UndoResult> => ({ ok: true, control: "contact", removed: true }));
    expect(await runContactUndo({ ...h, tr: en, typedName: "Ana Ruiz", listHref: "/dashboard/accounts/a1/contacts", undo })).toBe(true);
    expect(undo).toHaveBeenCalledWith("Ana Ruiz");
    expect(textOf(h.success.mock.calls[0]![0])).toBe("Customer removed. The call stays in Calls.");
    expect(h.navigate).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
  });
  it("a booking keeps them, in words, and nothing navigates", async () => {
    const h = harness();
    await runContactUndo({ ...h, tr: en, typedName: "Ana Ruiz", listHref: "/x", undo: async () => ({ ok: false, reason: "hasBooking" }) });
    expect(textOf(h.error.mock.calls[0]![0])).toBe("This can't be undone any more: Has a booking, so it stays.");
    expect(h.navigate).not.toHaveBeenCalled();
  });
});
