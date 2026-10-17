"use client";

import { LocaleProvider } from "@/components/locale-provider";
import type { ForwardingView } from "@/lib/email/inbound/forwarding-view";
import { ForwardingAddressRow } from "../accounts/[accountId]/contacts/[contactId]/forwarding-address-row";

/**
 * S-06 part 2 (spec §1): the record's Forwarding address row, in every kind the server's
 * `loadForwardingView` can hand it — the address with Copy (Replies on), the agency's turn-on line
 * (Replies off), the error, and "none" (Replies off for anyone else), which draws nothing at all —
 * plus the address in Spanish. Each sits in its own `<dl>`, as the row does inside the Details card.
 * Copy here writes a made-up address to the clipboard and toasts; nothing reaches an account.
 */
const ADDRESS = "r-0123456789abcdef01234567@reply.bis-rgv.com";
const KINDS: { id: string; view: ForwardingView }[] = [
  { id: "address", view: { kind: "address", address: ADDRESS } },
  { id: "turnOn", view: { kind: "turnOn" } },
  { id: "failed", view: { kind: "failed" } },
  { id: "none", view: { kind: "none" } },
];

export function ForwardingDemo() {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2" data-testid="styleguide-forwarding">
      <LocaleProvider locale="en">
        {KINDS.map(({ id, view }) => (
          <dl key={id} lang="en" data-forwarding-demo={id} className="min-w-0 space-y-1">
            <ForwardingAddressRow view={view} />
          </dl>
        ))}
      </LocaleProvider>
      <LocaleProvider locale="es">
        <dl lang="es" data-forwarding-demo="address-es" className="min-w-0 space-y-1">
          <ForwardingAddressRow view={{ kind: "address", address: ADDRESS }} />
        </dl>
      </LocaleProvider>
    </div>
  );
}
