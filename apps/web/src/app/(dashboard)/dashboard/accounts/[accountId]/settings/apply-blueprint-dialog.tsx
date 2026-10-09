"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import type { ApplyBlueprintResult } from "../../../blueprints/actions";

/** The success toast, in words: what was new and what was already here. */
export function appliedMessage(added: number, already: number): string {
  return m["blueprints.apply.done"]
    .replace("{added}", String(added))
    .replace("{already}", String(already));
}

/**
 * Applies a blueprint to THIS company from its Settings (D-086) — the place
 * the Add company dialog's hint now names. Sits beside "Save as blueprint" in
 * the page header and, like it, is an outline button: the cards below own the
 * page's primaries (rule 8). A choice of blueprint is a real decision, so it
 * is a dialog; the apply itself is additive, so no typed confirmation.
 *
 * Renders nothing when the agency has no blueprints: a button that could
 * only fail is not offered.
 */
export function ApplyBlueprintDialog({
  action, blueprints,
}: {
  action: (formData: FormData) => Promise<ApplyBlueprintResult>;
  blueprints: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  if (blueprints.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{m["accounts.blueprint"]}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{m["accounts.blueprint"]}</DialogTitle></DialogHeader>
        <form
          action={async (formData) => {
            let result: ApplyBlueprintResult;
            try {
              result = await action(formData);
            } catch (e) {
              console.error("apply-blueprint-dialog: apply failed", e);
              toast.error(m["blueprints.apply.failed"]);
              return;
            }
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(appliedMessage(result.added, result.already));
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="apply-blueprint">{m["blueprints.apply.label"]}</Label>
            <Select name="blueprintId" defaultValue={blueprints[0]!.id}>
              <SelectTrigger id="apply-blueprint" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {blueprints.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{m["blueprints.apply.hint"]}</p>
          </div>
          <DialogFooter>
            <SubmitButton>{m["blueprints.apply.submit"]}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
