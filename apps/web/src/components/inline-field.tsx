"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { normalizeFieldInput, type EditableField } from "@/lib/contacts/field-input";

/**
 * DESIGN.md record-view rule: small edits are inline — click the value,
 * edit, save on blur/Enter with an undo toast; Esc cancels. Undo re-runs
 * the same save with the prior value (spec §Writes). No form, no Save
 * button. Empty input clears the field (nullable columns).
 */
export function InlineField({
  label, field, value, save, inputType = "text",
}: {
  label: string;
  field: EditableField;
  value: string | null;
  save: (value: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  inputType?: "text" | "email" | "tel";
}) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(value ?? "");
  // Tracks the committed value for cancel/undo across saves.
  const committed = useRef(value ?? "");
  const cancelled = useRef(false);

  async function commit(raw: string) {
    const norm = normalizeFieldInput(field, raw);
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
        aria-label={m["inline.edit"].replace("{label}", label)}
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
