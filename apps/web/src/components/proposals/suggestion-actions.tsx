"use client";
// A suggestion card's buttons (item 8b-1, spec 4.5). The four server actions arrive as PROPS, each bound
// to the account by the page (`acceptSuggestion.bind(null, accountId)`, plan fix I-3: a server component
// cannot hand a client one an inline closure), and this file calls each with the suggestion's id. What a
// decision does after the server answers (the toast, its 10-second Undo, a refusal under its field) is
// `runDecision`'s, a pure handler with a unit test, because there is no DOM to test this file in.
//
// Rule 8 (P12): each card is its own view with ONE primary, Accept, or Save and accept while editing;
// everything else is ghost. `useTransition` disables every button while any one runs. The record's flat
// row (variant "row", item 8b-2) has NO primary: ghost Accept and ghost Discard, and no Edit, which
// happens in the tray (DESIGN.md rule 8 as amended 2026-10-19).
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, nativeFieldClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { SuggestionEdit, SuggestionLabels } from "@/lib/proposals/view";
import { runDecision, type SuggestionActionResult, type UndoResult } from "./suggestion-handlers";
import { FALLBACK_SEP } from "./focus-fallback";

export type SuggestionActionProps = {
  accept: (id: string) => Promise<SuggestionActionResult>;
  editAccept: (id: string, edit: Record<string, string>) => Promise<SuggestionActionResult>;
  discard: (id: string) => Promise<SuggestionActionResult>;
  undo: (id: string) => Promise<UndoResult>;
};

const CTL = "min-h-11 md:min-h-8";
const FIELD = "flex flex-col gap-1";
const ERROR = "text-xs text-destructive";
/** Painted as every native field is (input.tsx's nativeFieldClass; design review minor 1), with Input's
 *  invalid style for a refused stage. */
const SELECT = cn(nativeFieldClass, CTL,
  "text-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40");

/** Esc cancels the edit from any field but the stage <select>, whose own Esc closes its open list
 *  (review minor 8). Pure, so it is unit-tested without a DOM. */
export function escCancelsEdit(key: string, targetTag: string): boolean {
  return key === "Escape" && targetTag !== "SELECT";
}

type Focusable = { focus: () => void };
type CardLookup = { querySelector(selector: string): (Focusable & { getAttribute?: (name: string) => string | null }) | null };

/** Where focus may go once a decided card leaves, in order: suggestion ids, then fallback selectors. */
export type FocusPlan = { candidates: string[]; fallbacks: string[] };

/**
 * The plan, read off the list at decision time, before the card unmounts (item 8b-2; design review I3,
 * spec 4.5): the cards after `ownId` in its own list (document order across group boundaries, never the
 * card's next DOM sibling, which at a group's last card is a heading), then the cards before it, nearest
 * first, then the cards of the LATER lists in the same scope (`scopeIds`: the agency section's every card,
 * so an account's last card hands focus to the next account's first Accept), then the list's own
 * fallback headings. Pure.
 */
export function focusPlan(ids: readonly string[], ownId: string, scopeIds: readonly string[], fallbacks: readonly string[]): FocusPlan {
  const i = ids.indexOf(ownId);
  const after = i >= 0 ? ids.slice(i + 1) : [];
  const before = i > 0 ? ids.slice(0, i).reverse() : [];
  const at = scopeIds.indexOf(ownId);
  const later = at >= 0 ? scopeIds.slice(at + 1).filter((id) => !ids.includes(id)) : [];
  return { candidates: [...after, ...before, ...later], fallbacks: [...fallbacks] };
}

/**
 * Where focus goes once a decision has landed (design review minor 5), so it never falls to <body>.
 * The card still reads pending: the page's re-render has not landed, wait. The card stayed, decided (the
 * call page lists every status): its status line. The card left (the tray, the record's Waiting rows, the
 * agency page list pending only): the first planned card still present, on its Accept; else the first
 * fallback heading present (`heading`: the caller makes it focusable with tabIndex -1); else nothing.
 * Pure over a document-shaped lookup.
 */
export function decisionFocusTarget(doc: CardLookup, ownId: string, plan: FocusPlan): { wait: boolean; el: Focusable | null; heading: boolean } {
  const own = doc.querySelector(`[data-suggestion="${ownId}"]`);
  if (own) {
    if (own.getAttribute?.("data-status") === "pending") return { wait: true, el: null, heading: false };
    return { wait: false, el: doc.querySelector(`[data-suggestion="${ownId}"] [data-status-line]`), heading: false };
  }
  for (const id of plan.candidates) {
    const el = doc.querySelector(`[data-suggestion="${id}"] [data-suggestion-accept]`);
    if (el) return { wait: false, el, heading: false };
  }
  for (const sel of plan.fallbacks) {
    const el = doc.querySelector(sel);
    if (el) return { wait: false, el, heading: true };
  }
  return { wait: false, el: null, heading: false };
}

/** Reads the plan off the DOM while the card is still mounted (the list may unmount with it). */
function readFocusPlan(own: Element | null, ownId: string): FocusPlan {
  const list = own?.closest("[data-suggestion-list]") ?? null;
  const idsIn = (root: Element | null | undefined) =>
    [...(root?.querySelectorAll("[data-suggestion]") ?? [])].map((el) => el.getAttribute("data-suggestion") ?? "");
  const scope = list?.parentElement?.closest("[data-suggestion-scope]") ?? null;
  const fallbacks = (list?.getAttribute("data-focus-fallback") ?? "").split(FALLBACK_SEP).filter(Boolean);
  return focusPlan(idsIn(list), ownId, idsIn(scope), fallbacks);
}

/** Polls decisionFocusTarget until the re-render lands (bounded: 60 tries, 50 ms apart). It runs from a
 *  timer, not an effect, because in a list this component has unmounted by then. */
function focusAfterDecision(ownId: string, plan: FocusPlan, tries = 60) {
  const step = (left: number) => {
    const { wait, el, heading } = decisionFocusTarget(document, ownId, plan);
    if (wait && left > 0) { window.setTimeout(() => step(left - 1), 50); return; }
    // A heading takes focus only with a tabindex; -1 keeps it out of the Tab order.
    if (heading && el instanceof HTMLElement && !el.hasAttribute("tabindex")) el.tabIndex = -1;
    el?.focus();
  };
  window.setTimeout(() => step(tries), 0);
}

export function SuggestionActions({
  id, edit, labels, accept, editAccept, discard, undo, initialMode = "view", variant = "card",
}: SuggestionActionProps & {
  id: string; edit: SuggestionEdit; labels: SuggestionLabels;
  /** For the markup test and the styleguide; the card always starts in view. */
  initialMode?: "view" | "edit";
  /** "row": the record's flat row, ghost Accept and Discard only. */
  variant?: "card" | "row";
}) {
  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  /** The view's root (the form has formRef), to find this card and the one after it once a decision lands. */
  const rootRef = useRef<HTMLDivElement>(null);
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
        // A full reload, never router.refresh(): a tab pinned to an older deployment refreshes from it (A4).
        reload: () => { window.location.reload(); },
        labels: { undo: labels.undo, crashed: labels.crashed, reload: labels.reload, lang: labels.lang },
      });
      if (r.ok) {
        const plan = readFocusPlan(rootRef.current ?? formRef.current, id);
        setFieldError(null);
        setMode("view");
        focusAfterDecision(id, plan);
        return;
      }
      setFieldError(r.field ? { field: r.field, text: r.error } : null);
    });
  }

  function cancel() {
    returnFocus.current = true;
    setFieldError(null);
    setMode("view");
  }

  if (variant === "row") {
    return (
      <div ref={rootRef} className="flex flex-wrap gap-2">
        <Button data-suggestion-accept type="button" size="sm" variant="ghost" className={CTL} disabled={pending}
          onClick={() => run(() => accept(id))}>
          {labels.accept}
        </Button>
        <Button type="button" size="sm" variant="ghost" className={CTL} disabled={pending} onClick={() => run(() => discard(id))}>
          {labels.discard}
        </Button>
      </div>
    );
  }

  if (mode === "view") {
    return (
      <div ref={rootRef} className="flex flex-wrap gap-2">
        <Button data-suggestion-accept type="button" size="sm" className={CTL} disabled={pending} onClick={() => run(() => accept(id))}>
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
            {/* The model's English title (P18), so lang="en" under a Spanish card (design review minor 7). */}
            <Input {...fieldProps("title")} lang="en" type="text" defaultValue={edit.title} className={CTL} />
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
