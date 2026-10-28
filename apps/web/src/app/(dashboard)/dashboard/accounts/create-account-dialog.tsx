"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
import { TradeFields, type TradeSetup } from "@/components/vetting/trade-fields";
import { m } from "@/lib/messages";
import { NO_BLUEPRINT_SENTINEL } from "./constants";
import { AccountNameFields } from "./account-name-fields";
import { SubmitButton } from "./submit-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { settleCreateAccount } from "./create-account-feedback";
import { RefusalNotice, type Refusal } from "./refusal-notice";
import type { CreateAccountResult } from "./actions";

export function CreateAccountDialog({
  action,
  blueprints,
  trade,
}: {
  action: (formData: FormData) => Promise<CreateAccountResult>;
  blueprints: { id: string; name: string }[];
  trade: TradeSetup;
}) {
  const [open, setOpen] = useState(false);
  // S-53 (spec 5.1): a refusal is a FORM message, not a toast - the agency reads it and passes it on
  // (a held or turned-away trade's reason). Every refusal shows here now, so one place answers. It
  // carries its language (a trade refusal follows this dialog's; the rest are English).
  const [formError, setFormError] = useState<Refusal | null>(null);
  // A refusal the action returns is shown in its own words; an unexpected
  // throw gets the generic line; a successful create's redirect() propagates
  // so the navigation happens. The branching lives in
  // create-account-feedback.ts, where it is tested without a DOM.
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
        <Button>
          <Plus className="size-4" aria-hidden />
          {m["accounts.add"]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m["accounts.add"]}</DialogTitle>
        </DialogHeader>
        <form
          // onSubmit, NOT the `action` prop: on a failed create the dialog
          // stays open, and React's post-action reset cleared the name,
          // timezone and blueprint Select the operator had just filled in — so
          // a failed create meant re-entering all of it, and re-picking a
          // blueprint that had silently fallen back to "No blueprint". See
          // lib/forms/use-form-submit.ts. Nothing to reset on success: the
          // create either redirects or closes the dialog.
          onSubmit={onSubmit}
          className="space-y-4"
        >
          <AccountNameFields />
          <div className="space-y-2">
            <Label htmlFor="timezone">{m["accounts.timezone"]}</Label>
            <Input id="timezone" name="timezone" defaultValue="America/Chicago" />
          </div>
          {/* A refusal about the trade no longer on screen is stale: changing the trade clears it (design check M2). */}
          <TradeFields idPrefix="acct" {...trade} onTradeChange={() => setFormError(null)} />
          {blueprints.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="acct-blueprint">{m["accounts.blueprint"]}</Label>
              <Select name="blueprintId" defaultValue={NO_BLUEPRINT_SENTINEL}>
                <SelectTrigger id="acct-blueprint" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BLUEPRINT_SENTINEL}>{m["accounts.blueprintNone"]}</SelectItem>
                  {blueprints.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{m["accounts.blueprintHint"]}</p>
            </div>
          ) : null}
          {formError ? <RefusalNotice refusal={formError} /> : null}
          <DialogFooter>
            <SubmitButton pending={pending}>{m["common.add"]}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
