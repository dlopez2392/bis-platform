"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";

export function SaveBlueprintDialog({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{m["blueprints.save"]}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{m["blueprints.save"]}</DialogTitle></DialogHeader>
        <form
          action={async (formData) => {
            try { await action(formData); toast.success(m["blueprints.saved"]); setOpen(false); }
            catch { toast.error(m["blueprints.saveFailed"]); }
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="bp-name">{m["blueprints.name"]}</Label>
            <Input id="bp-name" name="name" required autoFocus />
            <p className="text-xs text-muted-foreground">{m["blueprints.saveHint"]}</p>
          </div>
          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
