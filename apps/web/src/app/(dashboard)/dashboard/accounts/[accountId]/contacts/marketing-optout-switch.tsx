"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { m } from "@/lib/messages";
import { flipMarketingOptOut, optOutSinceLine, runGuarded } from "@/lib/contacts/marketing-optout";
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
export function MarketingOptOutSwitch({ accountId, contactId, optedOutAt, timezone }: {
  accountId: string;
  contactId: string;
  /** `contacts.marketing_email_opted_out_at` — null means "may be emailed". */
  optedOutAt: string | null;
  /** The account's resolved zone (`renderZone`), for the "Off since" date. */
  timezone: string;
}) {
  const [checked, setChecked] = useState(optedOutAt !== null);
  // The stamp the "Off since" line reads. Dropped on the first flip and never
  // guessed back: after a tick the server's new stamp is not on this screen
  // (the drawer's summary is a one-shot fetch), and after untick-then-Undo
  // the server has RE-stamped at the undo's moment, so the old date would be
  // wrong. Saying nothing beats saying a date the screen cannot know.
  const [since, setSince] = useState(optedOutAt);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const id = useId();
  const hintId = `${id}-hint`;
  const sinceLine = checked ? optOutSinceLine(since, timezone) : null;

  // The tick and its toast's Undo go through this one guard (#122 m5).
  function run(work: () => Promise<void>) {
    runGuarded(busy, startTransition, work);
  }

  function flip(next: boolean) {
    if (pending || busy.current) return;
    setSince(null);
    run(() => flipMarketingOptOut(
      next,
      (optedOut) => setMarketingEmailOptOutAction(accountId, contactId, optedOut),
      setChecked,
      toast,
      run,
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
      {sinceLine ? (
        <p className="text-muted-foreground text-xs tabular-nums">{sinceLine}</p>
      ) : null}
      <p id={hintId} className="text-muted-foreground text-xs">{m["contact.marketingOptOut.hint"]}</p>
    </div>
  );
}
