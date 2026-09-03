"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { normalizeFieldInput, type EditableField } from "@/lib/contacts/field-input";

type ValidateResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * DESIGN.md record-view rule: small edits are inline — click the value,
 * edit, save on blur/Enter with an undo toast; Esc cancels. Undo re-runs
 * the same save with the prior value (spec §Writes). No form, no Save
 * button. Empty input clears the field (nullable columns) — UNLESS
 * `validate` says otherwise; see below.
 *
 * `field` (one of the five CONTACT columns, driving `normalizeFieldInput`'s
 * branch) OR `validate` (a caller-supplied rule) — never both, never
 * neither. This is deliberately a union, not one optional prop plus a
 * fallback: `field` is typed to the five contact columns for a reason —
 * passing one for a value that isn't a contact column (the account rename
 * in setup/steps/account.tsx is the first caller that isn't) would silently
 * run the WRONG validation branch (e.g. "first_name"'s rule, which allows
 * clearing to "" — wrong for a value the server rejects when empty). The
 * union makes that a compile error instead of a silent wrong-branch bug;
 * every existing contact call site is untouched, since passing `field`
 * alone (and omitting `validate`) still satisfies it exactly as before.
 */
export function InlineField(
  props: (
    | { field: EditableField; validate?: undefined }
    | { field?: undefined; validate: (raw: string) => ValidateResult }
  ) & {
    label: string;
    value: string | null;
    save: (value: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    inputType?: "text" | "email" | "tel";
  },
) {
  const { label, field, validate, value, save, inputType = "text" } = props;
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(value ?? "");
  // Tracks the committed value for cancel/undo across saves.
  const committed = useRef(value ?? "");
  const cancelled = useRef(false);

  async function commit(raw: string) {
    // `field` is guaranteed defined whenever `validate` is not — the union
    // above enforces that at every call site; this cast is what lets the
    // function body stay a single code path for both.
    const norm = validate ? validate(raw) : normalizeFieldInput(field as EditableField, raw);
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
    toast.success(m["inline.saved"].replace("{label}", label), {
      action: {
        label: m["common.undo"],
        onClick: () => {
          void save(prior).then((r) => {
            if (r.ok) { committed.current = prior; setShown(prior); }
            else toast.error(r.error);
          });
        },
      },
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
