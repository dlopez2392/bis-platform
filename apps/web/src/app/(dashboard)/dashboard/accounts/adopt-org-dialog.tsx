"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TradeFields, type TradeSetup } from "@/components/vetting/trade-fields";
import { m } from "@/lib/messages";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { SubmitButton } from "./submit-button";
import { settleCreateAccount } from "./create-account-feedback";
import { RefusalNotice, type Refusal } from "./refusal-notice";
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
  orgName, action, trade,
}: {
  orgName: string;
  action: (formData: FormData) => Promise<CreateAccountResult>;
  trade: TradeSetup;
}) {
  const [open, setOpen] = useState(false);
  // S-53 (spec 5.1): the same inline-refusal shape as Add company — a held or
  // turned-away trade's reason, read in the form rather than toasted away.
  const [formError, setFormError] = useState<Refusal | null>(null);
  const { pending, onSubmit } = useFormSubmit((formData) => {
    setFormError(null);
    return settleCreateAccount(() => action(formData), {
      close: () => setOpen(false),
      error: (text, lang) => setFormError({ text, lang }),
    });
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFormError(null); }}>
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
          {/* Changing the trade clears a refusal about the old one (design check M2). */}
          <TradeFields idPrefix="adopt" {...trade} onTradeChange={() => setFormError(null)} />
          {formError ? <RefusalNotice refusal={formError} /> : null}
          <DialogFooter>
            <SubmitButton pending={pending}>{m["accounts.add"]}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
