"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { ForwardingView } from "@/lib/email/inbound/forwarding-view";
import { copyForwardingAddress, getForwardingAddress } from "./forwarding-copy";
import { getForwardingAddressAction } from "./forwarding-actions";
import { forwardingShown } from "./forwarding-row-state";

/**
 * S-06 part 2, spec §1: one row in the Details card ("who they are"). The view is the server's. Owner
 * ruling 2026-10-17: a page view never makes the address, so a customer with none yet gets one ghost
 * "Get forwarding address", which makes it (through the crash-safe handler) and then shows it here.
 */
export function ForwardingAddressRow({ view, accountId, contactId }: { view: ForwardingView; accountId: string; contactId: string }) {
  const locale = useLocale();
  // Only the address a CLICK made lives in state; what shows is derived from the server's view on
  // every render (fix round 2, Important 3), so a refresh that brings an address is followed.
  const [made, setMade] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const shown = forwardingShown(view, made);
  if (shown.kind === "none") return null;
  const get = async () => {
    if (pending) return;
    setPending(true);
    const address = await getForwardingAddress(() => getForwardingAddressAction(accountId, contactId), toast, locale);
    setPending(false);
    if (address) setMade(address);
  };
  return (
    <div data-forwarding-row={shown.kind} className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{t(m, "contact.forwarding.label", locale)}</dt>
      <dd className="space-y-1">
        {shown.kind === "address" ? (
          <>
            <div className="flex items-center gap-2">
              <span className="min-w-0 select-all break-all font-mono text-xs text-card-foreground">{shown.address}</span>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                aria-label={t(m, "contact.forwarding.copyLabel", locale)}
                onClick={() => { void copyForwardingAddress(shown.address, typeof navigator === "undefined" ? undefined : navigator.clipboard, toast, locale); }}>
                {t(m, "contact.forwarding.copy", locale)}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t(m, "contact.forwarding.hint", locale)}</p>
          </>
        ) : shown.kind === "get" ? (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" disabled={pending}
            onClick={() => { void get(); }}>
            {t(m, "contact.forwarding.get", locale)}
          </Button>
        ) : shown.kind === "turnOn" ? (
          <p className="text-xs text-muted-foreground">{t(m, "contact.forwarding.turnOn", locale)}</p>
        ) : (
          <p role="alert" className="text-xs text-[var(--crit)]">{t(m, "contact.forwarding.failed", locale)}</p>
        )}
      </dd>
    </div>
  );
}
