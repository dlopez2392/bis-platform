// S-47e (spec 5.12.5): the Move and its Undo, minus React, so the toasts are testable without a browser.
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";
import { UNDO_WINDOW_MS } from "../calendar/undo-window";
import type { MoveHoldingResult, HoldingMoveUndo } from "./actions";

type Toaster = {
  success: (message: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => unknown;
  error: (message: string) => unknown;
};
type UndoResult = { ok: true; conversationId: string } | { ok: false; error: MessageKey };
export type MoveDeps = {
  move: () => Promise<MoveHoldingResult>;
  undo: (u: HoldingMoveUndo) => Promise<UndoResult>;
  toast: Toaster; tr: Tr;
  /** Opens a conversation in the inbox (?c=). */
  open: (conversationId: string) => void;
};

export async function moveAndToast(d: MoveDeps): Promise<MoveHoldingResult> {
  let r: MoveHoldingResult;
  try {
    r = await d.move();
  } catch {
    d.toast.error(d.tr.text("conversation.holding.moveFailed"));
    return { ok: false, error: "conversation.holding.moveFailed" };
  }
  if (!r.ok) {
    d.toast.error(d.tr.text(r.error));
    return r;
  }
  const undo = r.undo;
  d.toast.success(d.tr.text("conversation.holding.moved", { name: r.name }), {
    action: { label: d.tr.text("common.undo"), onClick: () => { void undoAndToast(d, undo); } },
    duration: UNDO_WINDOW_MS,
  });
  d.open(r.toConversationId);
  return r;
}

export async function undoAndToast(d: MoveDeps, undo: HoldingMoveUndo): Promise<void> {
  try {
    const u = await d.undo(undo);
    if (!u.ok) { d.toast.error(d.tr.text(u.error)); return; }
    d.toast.success(d.tr.text("conversation.holding.movedBack"));
    d.open(u.conversationId);
  } catch {
    d.toast.error(d.tr.text("conversation.holding.moveFailed"));
  }
}
