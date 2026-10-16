"use client";

import { HeldEmailList, type HeldItemView } from "../accounts/[accountId]/conversations/held-email-list";
import { HeldEmailSkeleton } from "../accounts/[accountId]/conversations/held-email-skeleton";

/**
 * Task 12 (S-06 part 1): the inbox's "Needs a look" filter — two held
 * items (one not on this customer's record, one unverified), the empty
 * state and the loading skeleton. A client component of its own, same
 * reasoning as `places-demo.tsx`/`documents-demo.tsx`: `HeldEmailList`'s
 * server actions (`fileHeldEmailAction` and its siblings) are never
 * reached from here — each click is inert against whatever account id
 * these fixtures carry, same as every other demo on this page.
 */
const ITEMS: HeldItemView[] = [
  {
    id: "sg-held-1",
    fromName: "Luis Martínez",
    fromEmail: "luis@example.com",
    subject: "Re: Your appointment",
    excerpt: "Is Thursday still ok? I may need to push it to the afternoon if that works.",
    receivedAt: "2026-10-16T15:00:00.000Z",
    reason: "not_on_record",
    suggestion: { contactId: "sg-ana", name: "Ana Ruiz" },
  },
  {
    id: "sg-held-2",
    fromName: null,
    fromEmail: "unknown-sender@example.com",
    subject: null,
    excerpt: "Can you confirm the estimate total before Friday?",
    receivedAt: "2026-10-15T19:30:00.000Z",
    reason: "unverified",
    suggestion: { contactId: "sg-pat", name: "Pat Nguyen" },
  },
];

export function HeldEmailsDemo() {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2" data-testid="styleguide-held-emails">
      <div className="min-w-0">
        <HeldEmailList accountId="sg" items={ITEMS} locale="en" timezone="America/Chicago" />
      </div>
      <div className="min-w-0" lang="es">
        <HeldEmailList accountId="sg" items={ITEMS} locale="es" timezone="America/Chicago" />
      </div>
      <div className="min-w-0">
        <HeldEmailList accountId="sg" items={[]} locale="en" timezone="America/Chicago" />
      </div>
      <div className="min-w-0">
        <HeldEmailSkeleton />
      </div>
    </div>
  );
}
