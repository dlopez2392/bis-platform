"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { ForwardingView } from "@/lib/email/inbound/forwarding-view";
import { copyForwardingAddress } from "./forwarding-copy";

/** S-06 part 2, spec §1: one row in the Details card ("who they are"). The view is the server's. */
export function ForwardingAddressRow({ view }: { view: ForwardingView }) {
  const locale = useLocale();
  if (view.kind === "none") return null;
  return (
    <div data-forwarding-row={view.kind} className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{t(m, "contact.forwarding.label", locale)}</dt>
      <dd className="space-y-1">
        {view.kind === "address" ? (
          <>
            <div className="flex items-center gap-2">
              <span className="min-w-0 select-all break-all font-mono text-xs text-card-foreground">{view.address}</span>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                aria-label={t(m, "contact.forwarding.copyLabel", locale)}
                onClick={() => { void copyForwardingAddress(view.address, typeof navigator === "undefined" ? undefined : navigator.clipboard, toast, locale); }}>
                {t(m, "contact.forwarding.copy", locale)}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t(m, "contact.forwarding.hint", locale)}</p>
          </>
        ) : view.kind === "turnOn" ? (
          <p className="text-xs text-muted-foreground">{t(m, "contact.forwarding.turnOn", locale)}</p>
        ) : (
          <p role="alert" className="text-xs text-[var(--crit)]">{t(m, "contact.forwarding.failed", locale)}</p>
        )}
      </dd>
    </div>
  );
}
