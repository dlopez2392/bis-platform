import { describe, it, expect, vi } from "vitest";
import { makeTr } from "@/lib/record/copy";
import { moveAndToast, undoAndToast } from "./holding-move-handlers";
import type { MoveHoldingResult, HoldingMoveUndo } from "./actions";

/**
 * S-47e (spec 5.12.5): the Move and its Undo, minus React (the S-47d `closed-days-card.tsx` shape), so the
 * toasts and the open() navigation are testable without a browser. Every assertion below is a typed-out
 * literal — never built from the catalogue the function under test also reads — per the "tests must be
 * able to fail" rule (a mismatch between the two would otherwise cancel out).
 */
function fakeToast() {
  return { success: vi.fn(), error: vi.fn() };
}

const UNDO: HoldingMoveUndo = { moveId: 41, fromConversationId: "conv1", toConversationId: "bc" };
const OK: MoveHoldingResult = { ok: true, toConversationId: "bc", name: "Beto Prueba", undo: UNDO };

describe("moveAndToast", () => {
  it("an ok move toasts Moved to <name> with an Undo action lasting 10000ms, and opens the new thread (mutation: drop duration -> FAILS)", async () => {
    const toast = fakeToast();
    const open = vi.fn();
    const undo = vi.fn();
    const r = await moveAndToast({ move: async () => OK, undo, toast, tr: makeTr("en"), open });
    expect(r).toEqual(OK);
    expect(toast.success).toHaveBeenCalledWith(
      "Moved to Beto Prueba.",
      { action: { label: "Undo", onClick: expect.any(Function) }, duration: 10_000 },
    );
    expect(open).toHaveBeenCalledWith("bc");
    expect(undo).not.toHaveBeenCalled();
  });

  it("pressing the toast's Undo action calls undo(), toasts Moved back., and opens the ORIGINAL (holding) conversation (mutation: open the wrong side -> FAILS)", async () => {
    const toast = fakeToast();
    const open = vi.fn();
    const undo = vi.fn(async () => ({ ok: true as const, conversationId: "conv1" }));
    await moveAndToast({ move: async () => OK, undo, toast, tr: makeTr("en"), open });
    const onClick = toast.success.mock.calls[0]![1]!.action!.onClick;
    await onClick();
    expect(undo).toHaveBeenCalledWith(UNDO);
    expect(toast.success).toHaveBeenCalledWith("Moved back.");
    expect(open).toHaveBeenCalledWith("conv1");
  });

  it("a role refusal toasts the exact sentence and never opens anything (mutation: generic error text -> FAILS)", async () => {
    const toast = fakeToast();
    const open = vi.fn();
    const r = await moveAndToast({
      move: async () => ({ ok: false, error: "conversation.holding.moveRole" }), undo: vi.fn(), toast, tr: makeTr("en"), open,
    });
    expect(r).toEqual({ ok: false, error: "conversation.holding.moveRole" });
    expect(toast.error).toHaveBeenCalledWith("Only an Owner or Staff can move these texts.");
    expect(open).not.toHaveBeenCalled();
  });

  it("a throw toasts the generic failed sentence, never an unhandled rejection (mutation: let the throw escape -> FAILS)", async () => {
    const toast = fakeToast();
    const open = vi.fn();
    const r = await moveAndToast({
      move: async () => { throw new Error("boom"); }, undo: vi.fn(), toast, tr: makeTr("en"), open,
    });
    expect(r).toEqual({ ok: false, error: "conversation.holding.moveFailed" });
    expect(toast.error).toHaveBeenCalledWith("That conversation couldn't be moved. Try again.");
    expect(open).not.toHaveBeenCalled();
  });

  it("an empty move (P32: someone already moved it) toasts moveEmpty and never opens anything (mutation: toast moveFailed for 'empty' -> FAILS)", async () => {
    const toast = fakeToast();
    const open = vi.fn();
    const r = await moveAndToast({
      move: async () => ({ ok: false, error: "conversation.holding.moveEmpty" }), undo: vi.fn(), toast, tr: makeTr("en"), open,
    });
    expect(r).toEqual({ ok: false, error: "conversation.holding.moveEmpty" });
    expect(toast.error).toHaveBeenCalledWith("These texts were already moved.");
    expect(open).not.toHaveBeenCalled();
  });

  it("Spanish: the moved and the role sentences (mutation: hard-code English -> FAILS)", async () => {
    const toast = fakeToast();
    await moveAndToast({ move: async () => OK, undo: vi.fn(), toast, tr: makeTr("es"), open: vi.fn() });
    expect(toast.success).toHaveBeenCalledWith(
      "Se movió a Beto Prueba.",
      { action: { label: "Deshacer", onClick: expect.any(Function) }, duration: 10_000 },
    );
    const toast2 = fakeToast();
    await moveAndToast({
      move: async () => ({ ok: false, error: "conversation.holding.moveEmpty" }), undo: vi.fn(), toast: toast2, tr: makeTr("es"), open: vi.fn(),
    });
    expect(toast2.error).toHaveBeenCalledWith("Estos mensajes ya se movieron.");
  });
});

describe("undoAndToast", () => {
  it("a successful undo toasts Moved back. and opens the holding conversation", async () => {
    const toast = fakeToast();
    const open = vi.fn();
    await undoAndToast({ move: vi.fn(), undo: async () => ({ ok: true, conversationId: "conv1" }), toast, tr: makeTr("en"), open }, UNDO);
    expect(toast.success).toHaveBeenCalledWith("Moved back.");
    expect(open).toHaveBeenCalledWith("conv1");
  });

  it("a failed undo toasts its own error and never opens anything (mutation: open anyway -> FAILS)", async () => {
    const toast = fakeToast();
    const open = vi.fn();
    await undoAndToast({
      move: vi.fn(), undo: async () => ({ ok: false, error: "conversation.holding.moveFailed" as const }), toast, tr: makeTr("en"), open,
    }, UNDO);
    expect(toast.error).toHaveBeenCalledWith("That conversation couldn't be moved. Try again.");
    expect(open).not.toHaveBeenCalled();
  });

  it("an undo that throws toasts the generic failed sentence (mutation: let the throw escape -> FAILS)", async () => {
    const toast = fakeToast();
    const open = vi.fn();
    await undoAndToast({ move: vi.fn(), undo: async () => { throw new Error("boom"); }, toast, tr: makeTr("en"), open }, UNDO);
    expect(toast.error).toHaveBeenCalledWith("That conversation couldn't be moved. Try again.");
    expect(open).not.toHaveBeenCalled();
  });

  it("Spanish: Se regresó. (mutation: hard-code English -> FAILS)", async () => {
    const toast = fakeToast();
    await undoAndToast({ move: vi.fn(), undo: async () => ({ ok: true, conversationId: "conv1" }), toast, tr: makeTr("es"), open: vi.fn() }, UNDO);
    expect(toast.success).toHaveBeenCalledWith("Se regresó.");
  });
});
