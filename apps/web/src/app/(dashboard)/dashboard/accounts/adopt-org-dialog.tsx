"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { m } from "@/lib/messages";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { SubmitButton } from "./submit-button";
import { settleCreateAccount } from "./create-account-feedback";
import type { CreateAccountResult } from "./actions";

/**
 * "Add as a company" for one half-created company (D-087): writes the account
 * row for the Clerk organisation that already exists, instead of the Add
 * company dialog's brand-new one. Asks only for the timezone — the name is
 * the organisation's own, which is what its invitations already say.
 *
 * An outline button: the page's one primary is Add company in the header
 * (rule 8). Same result shape and the same settleCreateAccount as the create
 * dialog, so a refusal stays open with its own words and success navigates.
 */
export function AdoptOrgDialog({
  orgName, action,
}: {
  orgName: string;
  action: (formData: FormData) => Promise<CreateAccountResult>;
}) {
  const [open, setOpen] = useState(false);
  const { pending, onSubmit } = useFormSubmit((formData) =>
    settleCreateAccount(() => action(formData), {
      close: () => setOpen(false),
      error: (message) => toast.error(message),
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{m["accounts.orphan.adopt"]}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m["accounts.orphan.adoptTitle"].replace("{name}", () => orgName)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">{m["accounts.orphan.adoptHint"]}</p>
          <div className="space-y-2">
            <Label htmlFor="adopt-timezone">{m["accounts.timezone"]}</Label>
            <Input id="adopt-timezone" name="timezone" defaultValue="America/Chicago" />
          </div>
          <DialogFooter>
            <SubmitButton pending={pending}>{m["accounts.add"]}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
