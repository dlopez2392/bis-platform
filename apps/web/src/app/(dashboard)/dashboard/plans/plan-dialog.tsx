"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { METER_KEYS, type Plan } from "@bis/db";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../accounts/submit-button";
import { centsToDollars } from "@/lib/billing/plan-form";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import type { PlanActionResult } from "./actions";

const FEATURES = ["voice_receptionist", "web_concierge"] as const;

/**
 * The one form for a plan, new or edited. An overlay is its own view, so its
 * Save is that view's ONE primary (DESIGN.md rule 8) and Cancel is ghost.
 * onSubmit, never the `action` prop: a failed save must not reset what the
 * operator typed (useFormSubmit's own comment). It closes and refreshes only
 * on success. Whatever error the action returns is shown as it came: the
 * action speaks only messages.ts copy, including "already saved, reload".
 *
 * The plan's `updatedAt` never passes through here. It is an opaque version
 * string the ROW hands to the update action; this dialog reads only the
 * terms, for the fields' defaults.
 *
 * The content scrolls inside the viewport: eight fields and two checkboxes
 * run past a phone's height, and a Save below the fold of a fixed overlay is
 * a Save nobody can reach.
 */
export function PlanDialog({
  title, trigger, plan, onSave,
}: {
  title: string;
  trigger: React.ReactNode;
  /** The stored plan when editing; omitted for a new one. */
  plan?: Plan;
  onSave: (formData: FormData) => Promise<PlanActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    let result: PlanActionResult;
    try {
      result = await onSave(formData);
    } catch {
      toast.error(m["common.actionCrashed"]);
      return;
    }
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(m["plans.saved"]);
    setOpen(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{m["plans.dialog.body"]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={field("name")}>{m["plans.field.name"]}</Label>
            <Input id={field("name")} name="name" required maxLength={60} defaultValue={plan?.name ?? ""} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={field("monthlyPrice")}>{m["plans.field.monthlyPrice"]}</Label>
            <Input
              id={field("monthlyPrice")} name="monthlyPrice" inputMode="decimal" className="tabular-nums"
              placeholder="49.00" defaultValue={plan ? centsToDollars(plan.monthlyPriceCents) : ""}
            />
          </div>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium text-card-foreground">{m["plans.field.meters"]}</legend>
            {METER_KEYS.map((key) => (
              <div key={key} className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={field(`allowance.${key}`)}>{m[`plans.field.allowance.${key}`]}</Label>
                  <Input
                    id={field(`allowance.${key}`)} name={`allowance.${key}`} inputMode="numeric" className="tabular-nums"
                    defaultValue={plan ? String(plan.allowances[key]) : "0"}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={field(`overage.${key}`)}>{m[`plans.field.overage.${key}`]}</Label>
                  <Input
                    id={field(`overage.${key}`)} name={`overage.${key}`} inputMode="decimal" className="tabular-nums"
                    placeholder="0.10" defaultValue={plan ? centsToDollars(plan.overageCents[key]) : ""}
                  />
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-card-foreground">{m["plans.field.features"]}</legend>
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2">
                <Checkbox id={field(`feature.${f}`)} name={`feature.${f}`} defaultChecked={plan?.features[f] ?? false} />
                <Label htmlFor={field(`feature.${f}`)}>{m[`plans.feature.${f}`]}</Label>
              </div>
            ))}
          </fieldset>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">{m["common.cancel"]}</Button>
            </DialogClose>
            <SubmitButton pending={pending}>{m["plans.save"]}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The page's ONE primary. It mints a draft id on the first Save of a new
 * plan and keeps it across failed retries, so every retry of this dialog's
 * Save lands on the same plan (the action's idempotency). The id is cleared
 * only after a success. It is minted in the event handler, not during render,
 * so the React Compiler purity lint has nothing to flag and SSR/hydration
 * never sees it.
 */
export function NewPlanButton({
  create, disabled,
}: {
  create: (draftId: string, formData: FormData) => Promise<PlanActionResult>;
  disabled: boolean;
}) {
  const draftId = useRef<string | null>(null);
  return (
    <PlanDialog
      title={m["plans.dialog.createTitle"]}
      trigger={<Button disabled={disabled}>{m["plans.new"]}</Button>}
      onSave={async (formData) => {
        draftId.current ??= crypto.randomUUID();
        const result = await create(draftId.current, formData);
        if (result.ok) draftId.current = null;
        return result;
      }}
    />
  );
}
