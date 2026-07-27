"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
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

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : m["common.save"]}
    </Button>
  );
}

export function AddOpportunityDialog({
  accountId,
  pipelineId,
  contacts,
  action,
}: {
  accountId: string;
  pipelineId: string;
  contacts: { id: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
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
          action={async (formData) => {
            try {
              await action(formData);
              setOpen(false);
            } catch {
              toast.error(m["pipeline.createFailed"]);
            }
          }}
          className="space-y-4"
        >
          <input type="hidden" name="accountId" value={accountId} />
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
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
