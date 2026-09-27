"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { PhoneCountry } from "@bis/db/phone";
import { Button } from "@/components/ui/button";
import { DotPill } from "@/components/dot-pill";
import { m } from "@/lib/messages";
import { runGuarded } from "@/lib/contacts/marketing-optout";
import { PHONE_CHECK_TREATMENT, pickPhoneCountry } from "@/lib/contacts/phone-country";
import { setPhoneCountryAction, undoPhoneCountryAction } from "./actions";

/**
 * The contact's Messages block, as PR-1 ships it: only the Texts row's Check
 * number state (consent chain spec §6, F-009). Renders NOTHING unless the
 * number could be Mexican or US; the other Texts states and the Email row
 * land in PR-2 and PR-3. Rendered in the drawer AND on the full contact page;
 * callers key it by contact so a different contact never inherits its state.
 *
 * The buttons are ghost (rule 8: nothing here is the view's primary), run at
 * once, and offer Undo (rule 6). Loading and error are the drawer's own
 * summary states: this row renders only from a loaded summary.
 */
export function PhoneCountryRow({ accountId, contactId, unconfirmed, onChanged = () => {} }: {
  accountId: string;
  contactId: string;
  /** The number could be Mexican or US (the summary's, or the page's). */
  unconfirmed: boolean;
  /** Called after a pick and after an Undo the server took, so the host can
   *  re-read the summary — the row is keyed by the flag, and a stale key
   *  otherwise never remounts it for the NEXT ambiguous number (re-review
   *  minor 1). A no-op by default. */
  onChanged?: () => void;
}) {
  const [checking, setChecking] = useState(unconfirmed);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  if (!checking) return null;

  function run(work: () => Promise<void>): boolean {
    return runGuarded(busy, startTransition, work);
  }

  function pick(country: PhoneCountry) {
    if (pending || busy.current) return;
    run(() => pickPhoneCountry(
      country,
      (c) => setPhoneCountryAction(accountId, contactId, c),
      (picked, previous) => undoPhoneCountryAction(accountId, contactId, picked, previous),
      setChecking,
      toast,
      run,
      onChanged,
    ));
  }

  return (
    <div className="space-y-1.5" data-testid="phone-country-row">
      <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
        {m["contact.messages.title"]}
      </p>
      <div className="flex items-center gap-2 text-sm">
        <span>{m["contact.messages.texts"]}</span>
        <DotPill {...PHONE_CHECK_TREATMENT} dense data-status="unconfirmed_number" />
      </div>
      <p className="text-muted-foreground text-xs">{m["contact.phoneCountry.line"]}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => pick("MX")}>
          {m["contact.phoneCountry.mx"]}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => pick("US")}>
          {m["contact.phoneCountry.us"]}
        </Button>
      </div>
    </div>
  );
}
