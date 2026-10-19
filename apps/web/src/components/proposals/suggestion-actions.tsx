"use client";
// A suggestion card's buttons (item 8b-1, spec 4.5). The four server actions arrive as PROPS, each bound
// to the account by the page (`acceptSuggestion.bind(null, accountId)`, plan fix I-3: a server component
// cannot hand a client one an inline closure), and this file calls each with the suggestion's id. What a
// decision does after the server answers (the toast, its 10-second Undo, a refusal under its field) is
// `runDecision`'s, a pure handler with a unit test, because there is no DOM to test this file in.
//
// Rule 8 (P12): each card is its own view with ONE primary, Accept, or Save and accept while editing;
// everything else is ghost. `useTransition` disables every button while any one runs.
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SuggestionEdit, SuggestionLabels } from "@/lib/proposals/view";
import { runDecision, type SuggestionActionResult, type UndoResult } from "./suggestion-handlers";

export type SuggestionActionProps = {
  accept: (id: string) => Promise<SuggestionActionResult>;
  editAccept: (id: string, edit: Record<string, string>) => Promise<SuggestionActionResult>;
  discard: (id: string) => Promise<SuggestionActionResult>;
  undo: (id: string) => Promise<UndoResult>;
};

const CTL = "min-h-11 md:min-h-8";
const FIELD = "flex flex-col gap-1";
const ERROR = "text-xs text-destructive";
const SELECT = "min-h-11 md:min-h-8 w-full rounded-[var(--radius-ctl)] border border-input bg-[var(--surface-2)] px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Esc cancels the edit from any field but the stage <select>, whose own Esc closes its open list
 *  (review minor 8). Pure, so it is unit-tested without a DOM. */
export function escCancelsEdit(key: string, targetTag: string): boolean {
  return key === "Escape" && targetTag !== "SELECT";
}

export function SuggestionActions({
  id, edit, labels, accept, editAccept, discard, undo, initialMode = "view",
}: SuggestionActionProps & {
  id: string; edit: SuggestionEdit; labels: SuggestionLabels;
  /** For the markup test and the styleguide; the card always starts in view. */
  initialMode?: "view" | "edit";
}) {
  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  /** Set by Cancel / Esc only, so focus returns to Edit and accept then, and never on the first render. */
  const returnFocus = useRef(false);
  // Focus follows the mode (review minor 2): into the first field when the edit opens, back to Edit and
  // accept when it is cancelled. Proven in the browser by the e2e; there is no DOM in the unit tests.
  useEffect(() => {
    if (mode === "edit") {
      formRef.current?.querySelector<HTMLElement>("input, select")?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [mode]);
  /** A stage move with no later stage to pick has nothing to edit (review minor 4). */
  const editable = edit.kind !== "opportunity_stage" || edit.options.length > 0;

  function run(act: () => Promise<SuggestionActionResult>) {
    startTransition(async () => {
      const r = await runDecision({
        act, undo: () => undo(id), toast, schedule: (fn, ms) => { setTimeout(fn, ms); },
        labels: { undo: labels.undo, crashed: labels.crashed },
      });
      if (r.ok) { setFieldError(null); setMode("view"); return; }
      setFieldError(r.field ? { field: r.field, text: r.error } : null);
    });
  }

  function cancel() {
    returnFocus.current = true;
    setFieldError(null);
    setMode("view");
  }

  if (mode === "view") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className={CTL} disabled={pending} onClick={() => run(() => accept(id))}>
          {labels.accept}
        </Button>
        {editable ? (
          <Button ref={editButtonRef} type="button" size="sm" variant="ghost" className={CTL} disabled={pending}
            onClick={() => setMode("edit")}>
            {labels.editAccept}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" className={CTL} disabled={pending} onClick={() => run(() => discard(id))}>
          {labels.discard}
        </Button>
      </div>
    );
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form: Record<string, string> = {};
    new FormData(e.currentTarget).forEach((v, k) => { if (typeof v === "string") form[k] = v; });
    run(() => editAccept(id, form));
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (escCancelsEdit(e.key, (e.target as HTMLElement).tagName)) { e.preventDefault(); cancel(); }
  }

  /** One field's control props: its id, and the error under it named by aria-describedby. */
  const fieldProps = (name: string) => {
    const err = fieldError?.field === name;
    return {
      id: `${uid}-${name}`, name, disabled: pending,
      "aria-invalid": err || undefined,
      "aria-describedby": err ? `${uid}-${name}-error` : undefined,
    };
  };
  const errorUnder = (name: string) => (fieldError?.field === name
    ? <p id={`${uid}-${name}-error`} className={ERROR}>{fieldError.text}</p>
    : null);

  return (
    <form ref={formRef} className="flex flex-col gap-3" onSubmit={submit} onKeyDown={onKeyDown}>
      {edit.kind === "task" ? (
        <>
          <div className={FIELD}>
            <Label htmlFor={`${uid}-title`}>{labels.title}</Label>
            <Input {...fieldProps("title")} type="text" defaultValue={edit.title} className={CTL} />
            {errorUnder("title")}
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${uid}-dueAt`}>{labels.due}</Label>
            <Input {...fieldProps("dueAt")} type="date" defaultValue={edit.dueDate} className={CTL} />
            {errorUnder("dueAt")}
          </div>
        </>
      ) : edit.kind === "contact_field" ? (
        <div className={FIELD}>
          <Label htmlFor={`${uid}-value`}>{edit.label}</Label>
          <Input {...fieldProps("value")} type="text" defaultValue={edit.value} className={CTL} />
          {errorUnder("value")}
        </div>
      ) : (
        <div className={FIELD}>
          <Label htmlFor={`${uid}-toStageId`}>{labels.stage}</Label>
          <select {...fieldProps("toStageId")} defaultValue={edit.toStageId} className={SELECT}>
            {edit.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {errorUnder("toStageId")}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" className={CTL} disabled={pending}>{labels.saveAccept}</Button>
        <Button type="button" size="sm" variant="ghost" className={CTL} disabled={pending} onClick={cancel}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
