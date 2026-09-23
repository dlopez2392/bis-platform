"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { m } from "@/lib/messages";
import { flipMarketingOptOut } from "@/lib/contacts/marketing-optout";
import { setMarketingEmailOptOutAction } from "./actions";

/**
 * "No marketing emails" — the operator ticks it when a customer replies
 * "stop" to a check-in or a referral ask (the footer on those emails promises
 * exactly that). Rendered in the contact drawer AND on the full contact page.
 *
 * Reversible, so it runs on click with an Undo toast (DESIGN.md rule 6); the
 * behaviour lives in `flipMarketingOptOut` (lib/contacts/marketing-optout.ts),
 * this is its shell. The box's state is local after the first render: the
 * action revalidates both contact paths, but the box has already moved (and
 * moves back on a failure), so it never waits on the refresh. Callers key
 * this by contact id so a different contact never inherits the state.
 */
export function MarketingOptOutSwitch({ accountId, contactId, optedOutAt }: {
  accountId: string;
  contactId: string;
  /** `contacts.marketing_email_opted_out_at` — null means "may be emailed". */
  optedOutAt: string | null;
}) {
  const [checked, setChecked] = useState(optedOutAt !== null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const hintId = `${id}-hint`;

  function flip(next: boolean) {
    if (pending) return;
    startTransition(() => flipMarketingOptOut(
      next,
      (optedOut) => setMarketingEmailOptOutAction(accountId, contactId, optedOut),
      setChecked,
      toast,
    ));
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          disabled={pending}
          onCheckedChange={(v) => flip(v === true)}
          aria-describedby={hintId}
        />
        <Label htmlFor={id} className="font-normal">{m["contact.marketingOptOut.label"]}</Label>
      </div>
      <p id={hintId} className="text-muted-foreground text-xs">{m["contact.marketingOptOut.hint"]}</p>
    </div>
  );
}
