"use client";
//
// The client boundary for a single proposal's Accept/Dismiss pair (Call
// Proposals Task 7). Follows `tasks/work-row-actions.tsx`'s own precedent:
// the two server actions are already bound to `(accountId, callId)` by
// `proposals.tsx` (a server component) and passed down as PROPS — never
// imported into this file directly. `useTransition` disables both buttons
// while either is pending, since only one of them will ever be clicked for a
// given proposal and a double-submit of either must not be possible
// mid-flight.
//
// NO UNDO TOAST, on either button, unlike `work-row-actions.tsx`'s Done/Not
// now: accepting writes a REAL CRM record (a task, a filled contact field, a
// moved pipeline card) through the same paths a human action uses, and
// dismissing is terminal by this feature's own design (`actions.ts`'s
// `dismissProposal` doc comment — the row is kept, decided, never revived).
// Matches the booking close-out buttons' posture (`work-row-actions.tsx:19-21`),
// not the task/conversation ones.
//
// Both ghost, never one `variant="default"`: DESIGN.md rule 8 wants ONE
// primary button per VIEW, and a call can carry more than one pending
// proposal at once — a primary Accept on every row would multiply the one
// affordance the rule protects, the same reason `work-row-actions.tsx`'s own
// Done/Not now are both ghost too.
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import type { ActionResult } from "./actions";

export function ProposalActions({
  proposalId,
  acceptProposal,
  dismissProposal,
  acceptedToast,
}: {
  proposalId: string;
  acceptProposal: (proposalId: string) => Promise<ActionResult>;
  dismissProposal: (proposalId: string) => Promise<ActionResult>;
  /** The kind-specific success copy, resolved by `proposals.tsx` — which
   *  knows the proposal's `kind` — so this file stays kind-agnostic. */
  acceptedToast: string;
}) {
  const [pending, startTransition] = useTransition();

  function runAccept() {
    startTransition(async () => {
      const result = await acceptProposal(proposalId);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(acceptedToast);
    });
  }

  function runDismiss() {
    startTransition(async () => {
      const result = await dismissProposal(proposalId);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(m["proposals.dismissed.toast"]);
    });
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={runAccept}>
        {m["proposals.accept"]}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={runDismiss}>
        {m["proposals.dismiss"]}
      </Button>
    </div>
  );
}
