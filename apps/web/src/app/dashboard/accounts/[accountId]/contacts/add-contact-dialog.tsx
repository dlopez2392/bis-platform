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
import { m } from "@/lib/messages";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? m["common.saving"] : m["common.save"]}
    </Button>
  );
}

export function AddContactDialog({
  accountId,
  action,
}: {
  accountId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          {m["contacts.add"]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m["contacts.add"]}</DialogTitle>
        </DialogHeader>
        <form
          action={async (formData) => {
            try {
              await action(formData);
              setOpen(false);
            } catch {
              toast.error(m["contacts.createFailed"]);
            }
          }}
          className="space-y-4"
        >
          <input type="hidden" name="accountId" value={accountId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">{m["contacts.firstName"]}</Label>
              <Input id="firstName" name="firstName" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">{m["contacts.lastName"]}</Label>
              <Input id="lastName" name="lastName" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{m["contacts.email"]}</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{m["contacts.phone"]}</Label>
            <Input id="phone" name="phone" />
          </div>
          <DialogFooter>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
