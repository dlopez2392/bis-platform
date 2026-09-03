"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { normalizeFieldInput, type EditableField } from "@/lib/contacts/field-input";

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
 */
export function InlineField(
  props: (
    | { field: EditableField; required?: undefined }
    | { field?: undefined; required: true }
  ) & {
    label: string;
    value: string | null;
    save: (value: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    inputType?: "text" | "email" | "tel";
  },
) {
  const { label, field, required, value, save, inputType = "text" } = props;
  // `field` is guaranteed defined whenever `required` is not — the union
  // above enforces that at every call site; this is what lets commit() and
  // the undo guard below share ONE rule instead of branching twice.
  const normalize = (raw: string): ValidateResult =>
    required ? normalizeRequired(raw) : normalizeFieldInput(field as EditableField, raw);
  const [editing, setEditing] = useState(false);
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
    let result: { ok: true } | { ok: false; error: string };
    try {
      result = await save(norm.value);
    } catch {
      result = { ok: false, error: m["inline.crashed"] };
    }
    if (!result.ok) {
      setShown(prior);
      toast.error(result.error);
      return;
    }
    committed.current = norm.value;
    // Undo re-runs `save` with the PRIOR value, straight past commit()'s
    // validation — so offering it for a prior this field's own rule rejects
    // is offering a button whose only possible outcome is a server error
    // toast. For a `required` field first filled in from empty that is EVERY
    // first save. Asked of the exact value undo would send, with the exact
    // rule the server will apply to it.
    const undoable = normalize(prior).ok;
    toast.success(m["inline.saved"].replace("{label}", label), {
      action: undoable
        ? {
            label: m["common.undo"],
            onClick: () => {
              void save(prior).then((r) => {
                if (r.ok) { committed.current = prior; setShown(prior); }
                else toast.error(r.error);
              });
            },
          }
        : undefined,
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { cancelled.current = false; setEditing(true); }}
        className={cn(
          "block w-full rounded-md px-2 py-1 text-left text-sm transition-colors",
          "hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          shown ? "text-foreground" : "text-muted-foreground italic",
        )}
        // Carries the VALUE, not just the field name — without it a screen
        // reader hears "Edit Email, button" and never the value itself,
        // since aria-label REPLACES the button's text content as the
        // accessible name rather than supplementing it.
        aria-label={`${m["inline.edit"].replace("{label}", label)}: ${shown || m["inline.empty"]}`}
      >
        {shown || m["inline.empty"]}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      type={inputType}
      defaultValue={shown}
      aria-label={label}
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
