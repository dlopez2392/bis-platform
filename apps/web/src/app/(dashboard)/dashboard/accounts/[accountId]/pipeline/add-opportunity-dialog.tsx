"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { m } from "@/lib/messages";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { DealContactPicker, dealSubmitBlock } from "./deal-contact-picker";

function Submit({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : m["common.save"]}
    </Button>
  );
}

/**
 * One press of Save, as a plain function (review M1) so it is tested without a DOM: no customer chosen never
 * reaches the action and says why; a failed action says so and the dialog stays open; success closes it.
 */
export async function submitNewDeal(formData: FormData, deps: {
  action: (formData: FormData) => Promise<void>; notify: (message: string) => void; close: () => void;
}): Promise<void> {
  const block = dealSubmitBlock(formData);
  if (block) {
    deps.notify(m[block]);
    return;
  }
  try {
    await deps.action(formData);
    deps.close();
  } catch {
    deps.notify(m["pipeline.createFailed"]);
  }
}

export function AddOpportunityDialog({
  accountId,
  pipelineId,
  action,
}: {
  accountId: string;
  pipelineId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { pending, onSubmit } = useFormSubmit((formData) =>
    submitNewDeal(formData, { action, notify: (message) => toast.error(message), close: () => setOpen(false) }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          {m["pipeline.add"]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m["pipeline.add"]}</DialogTitle>
        </DialogHeader>
        <form
          // onSubmit, NOT the `action` prop: on the catch path the dialog
          // stays open, and React's post-action reset cleared the contact
          // Select and every field the operator had just filled in — so a
          // failed create meant re-entering everything. See
          // lib/forms/use-form-submit.ts. Nothing to reset on success: the
          // dialog closes and the form unmounts.
          onSubmit={onSubmit}
          className="space-y-4"
        >
          <input type="hidden" name="pipelineId" value={pipelineId} />
          <div className="space-y-2">
            <p id="deal-contact-label" className="text-sm font-medium">{m["pipeline.contact"]}</p>
            <DealContactPicker accountId={accountId} labelId="deal-contact-label" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">{m["pipeline.name"]}</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="value">{m["pipeline.value"]}</Label>
            <Input id="value" name="value" type="number" step="0.01" />
          </div>
          <DialogFooter>
            <Submit pending={pending} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
