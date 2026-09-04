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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { m } from "@/lib/messages";
import { useFormSubmit } from "@/lib/forms/use-form-submit";

function Submit({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : m["common.save"]}
    </Button>
  );
}

export function AddOpportunityDialog({
  pipelineId,
  contacts,
  action,
}: {
  pipelineId: string;
  contacts: { id: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    try {
      await action(formData);
      setOpen(false);
    } catch {
      toast.error(m["pipeline.createFailed"]);
    }
  });
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
            <Label htmlFor="contactId">{m["pipeline.contact"]}</Label>
            <Select name="contactId" required>
              <SelectTrigger id="contactId" className="w-full">
                <SelectValue placeholder={m["pipeline.contact"]} />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
