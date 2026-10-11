"use client";

import { useState, useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { m } from "@/lib/messages";
import { applyAssignee, contactAssigneeSave, taskAssigneeSave, type AssignSave } from "./assign-handlers";

/** A person who can hold a customer or a task, as the picker names them. `AssignMember` (lib/assign/view.ts) fits. */
export type AssigneeOption = { userId: string; label: string };

/** Radix Select refuses an empty-string value, so Unassigned travels as this and is mapped back to null. */
export const NONE = "__unassigned__";

/** The picker's choices: Unassigned first, then each person by name. */
export function assigneeChoices(options: AssigneeOption[]): { value: string; label: string }[] {
  return [{ value: NONE, label: m["assign.unassigned"] }, ...options.map((o) => ({ value: o.userId, label: o.label }))];
}

/**
 * How a holder is named. Someone the options do not list (removed from the
 * team since this page loaded) is "Someone on the team", never Unassigned:
 * that would state a fact the page does not have.
 */
export function assigneeName(id: string | null, options: AssigneeOption[]): string {
  if (id === null) return m["assign.unassigned"];
  return options.find((o) => o.userId === id)?.label ?? m["assign.someone"];
}

/**
 * Reads as its value until used: no box, the trigger's own focus ring kept;
 * on hover it shows itself as the input it is (the ladder's input step and
 * the interactive edge). team-card.tsx's INLINE_TRIGGER, for the same reason.
 */
const INLINE_TRIGGER = "h-8 max-w-full border-transparent bg-transparent px-1.5 shadow-none hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] dark:bg-transparent dark:hover:bg-[var(--surface-2)]";

/**
 * "Assigned to" as an inline edit (spec §9; DESIGN.md Record views, rule 6):
 * pick a person or Unassigned, saved at once, Undo toast. Read-only (a
 * Technician, M4) is plain text. While a save is in flight the trigger is
 * disabled, never a spinner (rule 7). Esc closes the open list (Radix), and
 * only the list: it is the topmost dismissable layer, so a drawer around it
 * stays open.
 */
export function AssigneeField({ label, value, options, readOnly, save }: {
  label: string;
  value: string | null;
  options: AssigneeOption[];
  readOnly: boolean;
  save: AssignSave;
}) {
  const [current, setCurrent] = useState<string | null>(value);
  const [pending, startTransition] = useTransition();
  const nameOf = (id: string | null) => assigneeName(id, options);
  if (readOnly) return <span className="block px-1.5 py-1 text-sm">{nameOf(current)}</span>;
  const pick = (next: string | null) => {
    if (next === current) return;
    const prior = current;
    startTransition(() => applyAssignee(save, next, prior, nameOf, setCurrent));
  };
  return (
    <Select value={current ?? NONE} onValueChange={(v) => pick(v === NONE ? null : v)} disabled={pending}>
      <SelectTrigger size="sm" aria-label={label} className={INLINE_TRIGGER}>
        <SelectValue>
          <span className="truncate">{nameOf(current)}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {assigneeChoices(options).map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * A customer's "Assigned to" (the drawer and the record page). A read-only
 * viewer's page carries no team (lib/assign/view.ts reads none for a
 * Technician, nor for a client whose role could not be settled), so it cannot
 * name a holder by the team list. It says "You" only when the holder IS the
 * viewer (`viewerId`, their own person in this account). Being read-only does
 * not make every customer theirs: an Owner whose stored-role read failed is
 * read-only here while RLS still shows them every customer (Task 7 review,
 * I1), so any other holder is "Someone on the team". "You" is a read-only
 * label, never a choice in the editable picker.
 */
export function ContactAssigneeField({ accountId, contactId, value, options, readOnly, viewerId, onSaved }: {
  accountId: string;
  contactId: string;
  value: string | null;
  options: AssigneeOption[];
  readOnly: boolean;
  /** The viewer's own person in this account (readPersonId), or null when unknown. */
  viewerId: string | null;
  /** After a save that changed something, e.g. the record page's refresh (its task rows move with the customer, A4). */
  onSaved?: () => void;
}) {
  const shown = readOnly && value !== null && value === viewerId && !options.some((o) => o.userId === value)
    ? [...options, { userId: value, label: m["assign.you"] }]
    : options;
  return (
    <AssigneeField
      label={m["assign.field.label"]} value={value} options={shown} readOnly={readOnly}
      save={contactAssigneeSave(accountId, contactId, onSaved)}
    />
  );
}

/**
 * A task's "Assigned to" (To do and the record page's tasks). Rendered only
 * for someone who may hand tasks on: a Technician's page has no team to name
 * a holder by, and RLS does not make every task they see theirs (an Owner's
 * task on their customer), so "You" would not be safe here.
 */
export function TaskAssigneeField({ accountId, taskId, value, options }: {
  accountId: string;
  taskId: string;
  value: string | null;
  options: AssigneeOption[];
}) {
  return (
    <AssigneeField
      label={m["assign.field.label"]} value={value} options={options} readOnly={false}
      save={taskAssigneeSave(accountId, taskId)}
    />
  );
}
