import { createElement, type ReactElement } from "react";
import type { Tr } from "@/lib/record/copy";
import { REASON_KEY, type ActReason } from "./kinds/types";

/**
 * The sequencing behind an act row's three Undo controls (item 8c, plan Task 5 item 8; spec 5.2), with no
 * "use client" and no DOM: the toast, the navigation, the timer and the reload are injected
 * (the `cancel-booking.ts` and `suggestion-handlers.ts` shape), so it is unit-tested without jsdom. The
 * server actions' result types live here, because the client controls and `actions.ts` share them.
 *
 *   - a field runs at once (DESIGN.md rule 6) and its toast carries a 10-second Undo that puts Sofía's value
 *     back (`redoAiFieldFillAction`; plan ambiguity F);
 *   - a booking runs from its popover and says whether the customer was told; no redo (spec §3);
 *   - a customer, after the typed name, says where the call (or the chat's form entry) stays and goes to the
 *     contacts list.
 * No router refresh after a success (final review): each server action already calls `revalidatePath` for
 * the record, which hands the page's fresh render back with the action's own answer.
 * A refusal says why in words. A throw (the action never answered: a network failure, or a tab older than
 * the deployment) says reload, and offers it (8b-2's follow-up 1: a full reload, never a router refresh).
 * Every word handed to the toast is an element carrying the reader's `lang` (8b-1 design review I3).
 */

export type UndoFailReason = ActReason | "notAvailable" | "typedName";
export type UndoResult =
  | { ok: true; control: "field" }
  | { ok: true; control: "booking"; told: "yes" | "no" | "notAsked" }
  | { ok: true; control: "contact"; removed: true }
  | { ok: false; reason: UndoFailReason };
export type RedoResult = { ok: true } | { ok: false; reason: "changed" | "notAvailable" };

/** The field toast's life, and its Undo's (spec 5.2: "the usual 10-second Undo toast"). */
export const ACT_TOAST_MS = 10_000;

type Words = ReactElement;
type ToastOpts = { action?: { label: Words; onClick: () => void }; duration?: number };
export type ActToast = {
  success: (message: Words, opts?: ToastOpts) => string | number;
  error: (message: Words, opts?: ToastOpts) => string | number;
  dismiss: (id?: string | number) => unknown;
};
type Common = {
  toast: ActToast; tr: Pick<Tr, "text" | "locale">;
  /** `window.location.reload`, offered when the action never answered. */
  reload: () => void;
};

/** The words as an element carrying the reader's `lang`. */
function sayer(tr: Common["tr"]): (text: string) => Words {
  return function say(text: string): Words {
    return createElement("span", { lang: tr.locale }, text);
  };
}

/** A refusal's toast, always the reason in words (review M-4): a typed name that did not match says so; an
 *  act the server could not find, or already undone, says that. The reload sentence is for a throw only. */
function refuse({ toast, tr }: Common, reason: UndoFailReason | "changed"): void {
  const say = sayer(tr);
  if (reason === "typedName") {
    toast.error(say(tr.text("aiActs.toast.typedNameMismatch")));
    return;
  }
  // `changedBy` needs a name the client does not hold; the server never answers it (only the display does).
  const words = reason === "notAvailable" ? tr.text("aiActs.reason.gone")
    : tr.text(REASON_KEY[reason === "changedBy" ? "changed" : reason]);
  toast.error(say(tr.text("aiActs.toast.notAvailable", { reason: words })));
}

function unreachable({ toast, tr, reload }: Common): void {
  const say = sayer(tr);
  toast.error(say(tr.text("aiActs.toast.failed")), { action: { label: say(tr.text("suggestions.reload")), onClick: () => reload() } });
}

async function attempt<T>(c: Common, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    unreachable(c);
    return null;
  }
}

export async function runFieldUndo(deps: Common & {
  undo: () => Promise<UndoResult>; redo: () => Promise<RedoResult>;
  schedule: (fn: () => void, ms: number) => void;
  /** The field's words ("email", "el correo"), as the row's sentence names it. */
  field: string;
  /** The field was blank before she filled it: the Undo removes her value rather than putting one back. */
  wasEmpty: boolean;
  /** The receptionist's name as the account sets it. */
  persona: string;
}): Promise<boolean> {
  const { toast, tr, schedule } = deps;
  const say = sayer(tr);
  const r = await attempt(deps, deps.undo);
  if (!r) return false;
  if (!r.ok) {
    refuse(deps, r.reason);
    return false;
  }
  // Design I-5: say what happened to THIS field: her value removed (it was blank), or the earlier one back.
  const done = deps.wasEmpty
    ? tr.text("aiActs.toast.fieldRemoved", { field: deps.field, persona: deps.persona })
    : tr.text("aiActs.toast.fieldUndone", { field: deps.field });
  // Once per toast: a double click must not send a second redo.
  let fired = false;
  const id = toast.success(say(done), {
    action: {
      label: say(tr.text("common.undo")),
      onClick: () => {
        if (fired) return;
        fired = true;
        void (async () => {
          const u = await attempt(deps, deps.redo);
          if (!u) return;
          if (!u.ok) {
            refuse(deps, u.reason);
            return;
          }
          toast.success(say(tr.text("aiActs.toast.fieldRedone", { persona: deps.persona, field: deps.field })));
        })();
      },
    },
    duration: ACT_TOAST_MS,
  });
  // Closed at its time even while hovered (sonner pauses a hovered toast), so the redo is never offered late.
  schedule(() => { toast.dismiss(id); }, ACT_TOAST_MS);
  return true;
}

export async function runBookingUndo(deps: Common & {
  undo: (notify: boolean) => Promise<UndoResult>;
  /** The popover's "Let {name} know by email" box. */
  notify: boolean;
  /** The customer's name, for the told / not-told sentence. */
  name: string;
}): Promise<boolean> {
  const { toast, tr } = deps;
  const say = sayer(tr);
  const r = await attempt(deps, () => deps.undo(deps.notify));
  if (!r) return false;
  if (!r.ok) {
    refuse(deps, r.reason);
    return false;
  }
  const told = r.control === "booking" ? r.told : "notAsked";
  toast.success(say(told === "yes" ? tr.text("aiActs.toast.bookingUndoneTold", { name: deps.name })
    : told === "no" ? tr.text("aiActs.toast.bookingUndoneNotTold", { name: deps.name })
    : tr.text("aiActs.toast.bookingUndone")));
  return true;
}

export async function runContactUndo(deps: Common & {
  undo: (typedName: string) => Promise<UndoResult>;
  typedName: string;
  /** The web chat added them (review M-a): its form entry stays in Forms, and there is no call. */
  fromChat: boolean;
  navigate: (href: string) => void;
  /** The contacts list: the record page is gone once the customer is removed. */
  listHref: string;
}): Promise<boolean> {
  const { toast, tr } = deps;
  const say = sayer(tr);
  const r = await attempt(deps, () => deps.undo(deps.typedName));
  if (!r) return false;
  if (!r.ok) {
    refuse(deps, r.reason);
    return false;
  }
  toast.success(say(tr.text(deps.fromChat ? "aiActs.toast.contactRemovedChat" : "aiActs.toast.contactRemoved")));
  deps.navigate(deps.listHref);
  return true;
}
