"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input, nativeFieldClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { formatDateUTC } from "@/lib/format";
import { validateInlineRule, type InlineRule } from "@/lib/inline-rule";
import { normalizeFieldInput, type EditableField } from "@/lib/contacts/field-input";
import type { PhoneInlineUndo, InlinePhoneUndoWrite } from "@/lib/contacts/inline-phone-undo";
import { planInlineUndo, inlineSavedView } from "@/lib/contacts/inline-save";
// The `options` arm's validator lives in a plain module so the server action
// behind an options field can run the identical check (see its doc).
import { validateEnumValue } from "@/lib/enum-value";

type ValidateResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Trim, then reject empty — the rule for a value that has no meaningful
 * blank state. Lives HERE rather than at the call site because the prop
 * that selects it (`required`) has to be plain data: `account.tsx` is a
 * SERVER component, and React's Flight serializer refuses to send a
 * function across the server→client boundary this component is
 * ("Functions cannot be passed directly to Client Components") — a 500 on
 * every render of the page, not a degraded control.
 *
 * The message is `setup.rename.empty` deliberately: `renameAccountAction`
 * (setup/actions.ts:212) rejects the same input with the same string, so
 * the optimistic client check and the authoritative server one can't tell
 * the operator two different things about one keystroke. The only caller
 * today is the account rename; a second `required` caller wanting its own
 * wording is the moment to widen this to carry one, not before.
 */
function normalizeRequired(raw: string): ValidateResult {
  const value = raw.trim();
  if (!value) return { ok: false, error: m["setup.rename.empty"] };
  return { ok: true, value };
}

/**
 * DESIGN.md record-view rule: small edits are inline — click the value,
 * edit, save on blur/Enter with an undo toast; Esc cancels. Undo re-runs
 * the same save with the prior value (spec §Writes). No form, no Save
 * button. Empty input clears the field (nullable columns) — UNLESS
 * `required` says otherwise; see `normalizeRequired` above.
 *
 * `field` (one of the five CONTACT columns, driving `normalizeFieldInput`'s
 * branch) OR `required` (the trim-and-reject-empty rule) — never both,
 * never neither. This is deliberately a union, not one optional prop plus
 * a fallback: `field` is typed to the five contact columns for a reason —
 * passing one for a value that isn't a contact column (the account rename
 * in setup/steps/account.tsx is the first caller that isn't) would silently
 * run the WRONG validation branch (e.g. "first_name"'s rule, which allows
 * clearing to "" — wrong for a value the server rejects when empty). The
 * union makes that a compile error instead of a silent wrong-branch bug;
 * every existing contact call site is untouched, since passing `field`
 * alone (and omitting `required`) still satisfies it exactly as before.
 *
 * Both discriminants are SERIALIZABLE — a column name or a boolean — so a
 * server component can choose the rule without handing a function across
 * the RSC boundary.
 *
 * A fourth arm, `rule` (lib/inline-rule.ts's `InlineRule`, S-02 B2: a
 * property's address, notes and dates), is the same idea for a value that is
 * neither a contact column nor the account rename: a text limit in code
 * points or a real date, required or not, as plain data the server action
 * behind the field re-checks with the same `validateInlineRule`. It pairs
 * with `inputType` "multiline" (a Textarea; Enter is a new line, blur saves,
 * Esc cancels) or "date" (a native date input), `display: "date"` (at rest a
 * YYYY-MM-DD prints in words), and `locale`, which the field's own chrome
 * (Edit, Add…, saved, Undo, the crash line) follows; default "en", so every
 * caller that predates it is unchanged.
 */
export function InlineField(
  props: (
    | { field: EditableField; required?: undefined; options?: undefined; rule?: undefined }
    | { field?: undefined; required: true; options?: undefined; rule?: undefined }
    | { field?: undefined; required?: undefined; options: readonly { value: string; label: string }[]; rule?: undefined }
    | { field?: undefined; required?: undefined; options?: undefined; rule: InlineRule }
  ) & {
    label: string;
    value: string | null;
    /** Phone field only: the save may hand back `undo`, the server's OWN
     *  record of the prior phone and flag AND the value it actually stored
     *  (`lib/contacts/inline-phone-undo.ts`'s `PhoneInlineUndo`) — never a
     *  value this component captures itself. Every other field's `save`
     *  never returns one, and none is expected. An `undoWith` field's save
     *  may return `undoPayload` (handed to `undoWith`) and `shown`, the value
     *  the server actually stored, which the field then displays. */
    save: (value: string) => Promise<{ ok: true; undo?: PhoneInlineUndo; undoPayload?: unknown; shown?: string } | { ok: false; error: string }>;
    /** "multiline" edits in a Textarea (Enter is a new line; blur saves);
     *  "date" is a native date input whose value is YYYY-MM-DD. */
    inputType?: "text" | "email" | "tel" | "date" | "multiline";
    /** "date": at rest, a YYYY-MM-DD value prints with formatDateUTC in the
     *  locale ("Mar 3, 2019"), never the stored string. */
    display?: "date";
    /** The language of the field's OWN chrome; default "en". */
    locale?: Locale;
    /** Phone field only: the dedicated undo write, given exactly the
     *  `PhoneInlineUndo` the save returned. When absent (or the field isn't
     *  phone, or the save returned no `undo`), undo falls back to
     *  `save(prior)` exactly as every other field's undo always has. */
    undoPhone?: InlinePhoneUndoWrite;
    /** A field whose save hands back its own server-built undo (the Business
     *  name, S-02 §6 row 3): Undo calls this with exactly that payload instead
     *  of re-saving the prior text. Absent: the default `save(prior)` undo. */
    undoWith?: (payload: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** What an EMPTY field shows in place of the generic "Add…", and the
     *  input's placeholder while editing (the Groups card's role, S-02 §8:
     *  "Role, like Madre or Dueño"). Shown, never stored. */
    placeholder?: string;
    /** Told whenever editing starts or stops (the Business name holds its
     *  remount key while the operator types, so a refresh never throws the
     *  typed text away). */
    onEditingChange?: (editing: boolean) => void;
    /** When given, the field shows no saved toast of its own: the caller
     *  announces the save in its own words, with its own Undo, given the
     *  prior value and the one now stored (the Properties card's owner
     *  change, places spec §7: "{place} now belongs to {owner}."). Errors
     *  are still the field's to say. Absent: the field's own toast, as ever. */
    onSaved?: (prior: string, stored: string) => void;
  },
) {
  const { label, field, required, options, rule, value, save, inputType = "text", display: atRest, locale = "en", undoPhone, undoWith, placeholder, onEditingChange, onSaved } = props;
  // `field` is guaranteed defined whenever none of `rule`, `required` and
  // `options` is — the four-way union above enforces that at every call
  // site; this is what lets commit() and the undo guard below share ONE
  // rule instead of branching four ways.
  const normalize = (raw: string): ValidateResult =>
    rule ? validateInlineRule(rule, raw, locale)
    : options ? validateEnumValue(options, raw)
    : required ? normalizeRequired(raw)
    : normalizeFieldInput(field as EditableField, raw);
  const [editing, setEditingState] = useState(false);
  // The ONE way editing changes, so onEditingChange hears every path: click, commit and Esc.
  const setEditing = (next: boolean) => { setEditingState(next); onEditingChange?.(next); };
  const [shown, setShown] = useState(value ?? "");
  // Tracks the committed value for cancel/undo across saves.
  const committed = useRef(value ?? "");
  const cancelled = useRef(false);

  async function commit(raw: string) {
    const norm = normalize(raw);
    if (!norm.ok) {
      toast.error(norm.error);
      setShown(committed.current);
      setEditing(false);
      return;
    }
    setEditing(false);
    if (norm.value === committed.current) return; // no-op edit — no toast
    const prior = committed.current;
    setShown(norm.value);
    let result: { ok: true; undo?: PhoneInlineUndo; undoPayload?: unknown; shown?: string } | { ok: false; error: string };
    try {
      result = await save(norm.value);
    } catch {
      result = { ok: false, error: t(m, "inline.crashed", locale) };
    }
    if (!result.ok) {
      setShown(prior);
      toast.error(result.error);
      return;
    }
    // I3: show what the server STORED when it says (the Business name keeps
    // the existing business spelling), and say so when nothing changed.
    const view = inlineSavedView(norm.value, label, result, locale);
    committed.current = view.shown;
    setShown(view.shown);
    if (onSaved) { onSaved(prior, view.shown); return; }
    // Whether Undo is offered, and the ONE write it runs, is decided by
    // planInlineUndo (lib/contacts/inline-save.ts, pinned there by behaviour):
    // phone and an `undoWith` field undo with the payload THIS save handed
    // back, never a value captured here (review C1); every other field
    // re-saves the prior text, offered only when its own rule accepts it.
    const undo = planInlineUndo({
      field, prior, priorValid: normalize(prior).ok,
      phoneUndo: result.undo, ownUndo: result.undoPayload,
      save, undoPhone, undoWith,
    });
    const notify = view.kind === "already" ? toast.info : toast.success;
    notify(view.message, {
      action: undo
        ? {
            label: t(m, "common.undo", locale),
            onClick: () => {
              void undo().then((r) => {
                if (r.ok) { committed.current = prior; setShown(prior); }
                else toast.error(r.error);
              });
            },
          }
        : undefined,
    });
  }

  if (!editing) {
    // I9: an options field shows the option's LABEL ("Español"), never its
    // stored value ("es") — on the button and in its accessible name. An
    // unknown stored value is still shown as-is rather than hidden. A date
    // field (`display: "date"`) prints its YYYY-MM-DD in the reader's words.
    const stored = atRest === "date" && shown ? formatDateUTC(shown, locale) : shown;
    const display = (options?.find((o) => o.value === shown)?.label ?? stored) || placeholder || t(m, "inline.empty", locale);
    return (
      <button
        type="button"
        onClick={() => { cancelled.current = false; setEditing(true); }}
        className={cn(
          // A long unbroken value (a 60-letter name) breaks anywhere rather than pushing its host,
          // and the page, sideways: every host wraps for free (design check 1a). Display only:
          // the editing input/select/textarea below are untouched.
          "block w-full rounded-[var(--radius-ctl)] px-2 py-1 text-left text-sm transition-colors [overflow-wrap:anywhere]",
          "hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          shown ? "text-foreground" : "text-muted-foreground italic",
          // A multi-line value keeps the line breaks it was typed with.
          inputType === "multiline" && "whitespace-pre-line",
        )}
        // Carries the VALUE, not just the field name — without it a screen
        // reader hears "Edit Email, button" and never the value itself,
        // since aria-label REPLACES the button's text content as the
        // accessible name rather than supplementing it.
        aria-label={`${t(m, "inline.edit", locale, { label })}: ${display}`}
      >
        {display}
      </button>
    );
  }

  if (options) {
    return (
      <select
        autoFocus
        defaultValue={shown}
        aria-label={label}
        className={cn(nativeFieldClass, "h-8")}
        onBlur={(e) => { if (!cancelled.current) void commit(e.currentTarget.value); cancelled.current = false; }}
        onKeyDown={(e) => { if (e.key === "Escape") { cancelled.current = true; setShown(committed.current); setEditing(false); } }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  if (inputType === "multiline") {
    // Enter is a new line here, not a save: blur saves, Esc cancels.
    return (
      <Textarea
        autoFocus
        defaultValue={shown}
        aria-label={label}
        placeholder={placeholder}
        rows={3}
        onBlur={(e) => {
          if (cancelled.current) { cancelled.current = false; return; }
          void commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            cancelled.current = true;
            setShown(committed.current);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <Input
      autoFocus
      type={inputType}
      defaultValue={shown}
      aria-label={label}
      placeholder={placeholder}
      className="h-8"
      onBlur={(e) => {
        if (cancelled.current) { cancelled.current = false; return; }
        void commit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur(); // blur path does the save — one code path
        if (e.key === "Escape") {
          cancelled.current = true;
          setShown(committed.current);
          setEditing(false);
        }
      }}
    />
  );
}
