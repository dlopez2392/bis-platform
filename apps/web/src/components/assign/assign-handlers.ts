import { toast } from "sonner";
import {
  assignContactsAction, undoAssignContactsAction, type AssignError,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions";
import { setTaskAssigneeAction } from "@/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions";
import { fill } from "@/components/team/team-copy";
import { m } from "@/lib/messages";

/**
 * What a pick in an "Assigned to" field does (F-085 part 1, spec §9; DESIGN.md
 * rule 6 and Record views): the change runs AT ONCE, then a toast says what
 * happened and offers Undo. No confirm dialog. Plain async functions rather
 * than hooks, so assign.test.ts reaches every toast and every Undo without a
 * DOM (team-handlers.ts is the precedent).
 */

export type AssignUndoResult = { ok: true } | { ok: false; error: AssignError };
/**
 * A save's answer. `undo: null` means NOTHING CHANGED (re-picking the
 * current holder): no toast, and no Undo that could only do harm. The
 * caller builds the undo, because only it knows the exact way back.
 */
export type AssignSaveResult =
  | { ok: true; undo: null | (() => Promise<AssignUndoResult>) }
  | { ok: false; error: AssignError };
export type AssignSave = (next: string | null) => Promise<AssignSaveResult>;

/** Long enough to notice a wrong pick; team-handlers.ts's TEAM_TOAST_MS for the same reason. */
export const ASSIGN_TOAST_MS = 10_000;

/**
 * A customer. The Undo hands `undoAssignContactsAction` the returned
 * `PreviousAssignee[]` WHOLE (each entry's `target` and `movedTaskIds`
 * included): replaying the save with the earlier holder would go back through
 * `assignContacts` and pull that person's own earlier tasks over (Task 2
 * review m1). `previous = []` is "nothing changed". `onSaved` runs only
 * after a real change, and again after its Undo (the record page refreshes:
 * the customer's open tasks moved with them, A4, and back).
 */
export function contactAssigneeSave(accountId: string, contactId: string, onSaved?: () => void): AssignSave {
  return async (next) => {
    const r = await assignContactsAction(accountId, [contactId], next);
    if (!r.ok) return r;
    const previous = r.previous;
    if (previous.length === 0) return { ok: true, undo: null };
    onSaved?.();
    return {
      ok: true,
      undo: async () => {
        const u = await undoAssignContactsAction(accountId, previous);
        if (u.ok) onSaved?.();
        return u;
      },
    };
  };
}

/**
 * A task: its Undo sets the task back to the holder the save replaced, only
 * while the holder the save set still has it (final review M7): someone who
 * picked the task since keeps it, and the Undo answers "assign.changed".
 */
export function taskAssigneeSave(accountId: string, taskId: string): AssignSave {
  return async (next) => {
    const r = await setTaskAssigneeAction(accountId, taskId, next);
    if (!r.ok) return r;
    const previous = r.previous;
    if (previous === next) return { ok: true, undo: null };
    return {
      ok: true,
      undo: async () => {
        const u = await setTaskAssigneeAction(accountId, taskId, previous, next);
        return u.ok ? { ok: true } : u;
      },
    };
  };
}

/**
 * Saves `next`; on success shows it (`show`) and, when something changed,
 * toasts "Assigned to {name}." / "Now unassigned." with an Undo that runs the
 * save's own undo and shows `prior` again. A refusal toasts its own sentence
 * (every AssignError is a message key) and leaves `prior` on screen. A throw
 * (a stale tab posting an old action id) is "That didn't save".
 */
export async function applyAssignee(
  save: AssignSave, next: string | null, prior: string | null,
  nameOf: (id: string | null) => string, show: (value: string | null) => void,
): Promise<void> {
  let r: AssignSaveResult;
  try {
    r = await save(next);
  } catch {
    toast.error(m["assign.failed"]);
    return;
  }
  if (!r.ok) {
    toast.error(m[r.error]);
    return;
  }
  show(next);
  const undo = r.undo;
  if (!undo) return;
  const message = next === null ? m["assign.doneUnassigned"] : fill(m["assign.done"], { name: nameOf(next) });
  toast.success(message, {
    duration: ASSIGN_TOAST_MS,
    action: {
      label: m["assign.undo"],
      onClick: () => {
        void undo()
          .then((u) => { if (u.ok) show(prior); else toast.error(m[u.error]); })
          .catch(() => toast.error(m["assign.failed"]));
      },
    },
  });
}
