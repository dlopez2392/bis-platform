"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { parseEquipmentFields, EQUIPMENT_LIMITS } from "@/lib/contacts/place-input";
import { addEquipmentAction, replaceEquipmentAction } from "./places-actions";

const hintClass = "text-xs text-muted-foreground";
type Draft = { name: string; make: string; model: string; serial: string; installed_on: string; warranty_until: string; notes: string };
const blank = (name: string, installedOn: string): Draft =>
  ({ name, make: "", model: "", serial: "", installed_on: installedOn, warranty_until: "", notes: "" });

/** Add a unit at a property, or replace a current one (which keeps the old unit in its history). */
export type EquipmentDialogMode = { kind: "add"; placeId: string } | { kind: "replace"; unit: { id: string; name: string } };

/**
 * Spec §8: "Add equipment" under a property; "Replace" on a current unit opens the same form with
 * the old unit's name carried over and "When was it replaced?" defaulting to the account's own
 * today, required (0071's equipment_replacement_dated). One primary button (rule 8); Radix closes
 * on Esc and returns focus to the trigger. place-input.ts checks the form before the action, which
 * checks it again; a refusal is read out in a polite live region inside the dialog.
 */
export function EquipmentDialog({ accountId, contactId, today, mode, onDone }: {
  accountId: string; contactId: string; today: string; mode: EquipmentDialogMode;
  /** The new unit's id and name, once it is saved. */
  onDone: (id: string, name: string) => void;
}) {
  const locale = useLocale();
  const tt = (key: string, params?: Record<string, string | number>) => t(m, key as MessageKey, locale, params);
  const id = useId();
  const replacing = mode.kind === "replace";
  const initial = () => (replacing ? blank(mode.unit.name, today) : blank("", ""));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const reset = () => { setDraft(initial()); setError(null); };

  const { pending, onSubmit } = useFormSubmit(async () => {
    const parsed = parseEquipmentFields(draft, today, { replacement: replacing }, locale);
    if (!parsed.ok) { setError(tt(parsed.error.key, parsed.error.params)); return; }
    const r = await (replacing
      ? replaceEquipmentAction(accountId, contactId, mode.unit.id, draft)
      : addEquipmentAction(accountId, contactId, mode.placeId, draft)
    ).catch(() => ({ ok: false as const, error: "places.error.failed" }));
    if (!r.ok) { setError(tt(r.error, "params" in r ? r.params : undefined)); return; }
    onDone(r.unit.id, r.unit.name);
    reset();
    setOpen(false);
  });

  const text = (k: "name" | "make" | "model" | "serial", labelKey: string, hintKey?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${k}`}>{tt(labelKey)}</Label>
      <Input id={`${id}-${k}`} value={draft[k]} onChange={set(k)} maxLength={EQUIPMENT_LIMITS[k]} autoComplete="off"
        required={k === "name"} aria-describedby={hintKey ? `${id}-${k}-hint` : undefined} />
      {hintKey ? <p id={`${id}-${k}-hint`} className={hintClass}>{tt(hintKey)}</p> : null}
    </div>
  );
  const date = (k: "installed_on" | "warranty_until", labelKey: string, required: boolean, max?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${k}`}>{tt(labelKey)}</Label>
      <Input id={`${id}-${k}`} type="date" value={draft[k]} onChange={set(k)} required={required} max={max} />
    </div>
  );
  const title = replacing ? tt("equipment.replaceTitle", { name: mode.unit.name }) : tt("equipment.add");

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        {replacing
          ? <Button type="button" size="xs" variant="ghost" aria-label={title}>{tt("equipment.replace")}</Button>
          : <Button type="button" size="sm" variant="ghost"><Plus className="size-4" aria-hidden />{tt("equipment.add")}</Button>}
      </DialogTrigger>
      <DialogContent lang={locale}>
        <DialogHeader><DialogTitle className="break-words">{title}</DialogTitle></DialogHeader>
        <form className="min-w-0 space-y-4" onSubmit={onSubmit}>
          {text("name", "equipment.name", "equipment.nameHint")}
          <div className="grid gap-2 sm:grid-cols-2">
            {text("make", "equipment.make")}
            {text("model", "equipment.model")}
          </div>
          {text("serial", "equipment.serial")}
          <div className="grid gap-2 sm:grid-cols-2">
            {date("installed_on", replacing ? "equipment.replaceDate" : "equipment.installDate", replacing, today)}
            {date("warranty_until", "equipment.warrantyUntil", false)}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-notes`}>{tt("equipment.notes")}</Label>
            <Textarea id={`${id}-notes`} rows={2} value={draft.notes} onChange={set("notes")} maxLength={EQUIPMENT_LIMITS.notes} />
          </div>
          <div aria-live="polite" data-equipment-dialog-error>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">{tt("places.dialog.cancel")}</Button></DialogClose>
            <Button type="submit" disabled={pending}>{replacing ? tt("equipment.replace") : tt("places.dialog.add")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
