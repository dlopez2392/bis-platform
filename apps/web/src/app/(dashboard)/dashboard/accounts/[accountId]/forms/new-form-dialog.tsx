"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";

export function NewFormDialog({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">{m["forms.add"]}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{m["forms.add"]}</DialogTitle></DialogHeader>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="form-name">{m["forms.name"]}</Label>
            <Input id="form-name" name="name" required autoFocus />
          </div>
          <SubmitButton>{m["common.add"]}</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
