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
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

export function NewFormDialog({
  action, locale = "en", pseudo = false,
}: { action: (formData: FormData) => Promise<void>; locale?: Locale; pseudo?: boolean }) {
  const [open, setOpen] = useState(false);
  const tr = makeTr(locale, pseudo);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">{tr.text("forms.add")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{tr.text("forms.add")}</DialogTitle></DialogHeader>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="form-name">{tr.text("forms.name")}</Label>
            <Input id="form-name" name="name" required autoFocus />
          </div>
          <SubmitButton>{tr.text("common.add")}</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
