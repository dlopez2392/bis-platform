"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { m } from "@/lib/messages";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import type { A2pRegistration, A2pStatus } from "@bis/db";

/** Rendered in catalogue order, which is also the order a registration moves
 *  through. Built from a literal rather than mapped over the union so the copy
 *  key for each status is checked at compile time. */
const STATUS_OPTIONS: readonly { value: A2pStatus; label: string }[] = [
  { value: "not_started", label: m["a2p.status.not_started"] },
  { value: "pending", label: m["a2p.status.pending"] },
  { value: "approved", label: m["a2p.status.approved"] },
  { value: "rejected", label: m["a2p.status.rejected"] },
];

/**
 * Agency-only by construction: rendered from the checklist page, which is
 * gated by requireAgencyOnlyAccountAccess. A client must never see it — the
 * carriers' verdict is not theirs to type, and the checklist item above now
 * derives from what is recorded here.
 *
 * A client component because the save toasts, and because the failure it most
 * needs to report is the one a thrown action cannot: setA2pRegistrationAction
 * returns {ok:false} rather than throwing, so the operator gets a toast they
 * can retry instead of the dashboard's generic error boundary (which Next
 * redacts to a digest in production).
 */
export function A2pPanel({
  registration, recordedAt, action,
}: {
  registration: A2pRegistration | null;
  /** Already formatted in the ACCOUNT's timezone by the page, so nothing here
   *  can format an instant in the viewer's clock — the repeated timezone
   *  defect in this codebase. (`registration` does still carry the raw
   *  `updatedAt` across the boundary in the props payload; the narrower prop
   *  type is what keeps this component from reaching for it.) Null when the
   *  registration has never been recorded. */
  recordedAt: string | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  // A missing row is not a state the operator can be in on this page — the
  // account had to exist to reach it — but the read is nullable, so this
  // renders the same thing a fresh account shows rather than crashing.
  const current = registration ?? { brandId: null, campaignId: null, status: "not_started" as const };

  // CONTROLLED, not defaultValue — and this is load-bearing, not style.
  // React resets an uncontrolled `<form action={fn}>` once the action
  // resolves, INCLUDING when it resolves to {ok:false}. A refused save does
  // not revalidate (correctly — nothing was written), so that reset restored
  // the OLD server values and silently threw away what the operator had
  // chosen. The fields still looked populated, so the next Save submitted the
  // stale status: an approval typed by a human landed in the database as
  // `not_started`, with the ids written. Hit on the first real use of this
  // panel. calendar-settings.tsx holds its fields in state for the same
  // reason. Do not revert these to defaultValue.
  const [brandId, setBrandId] = useState(current.brandId ?? "");
  const [campaignId, setCampaignId] = useState(current.campaignId ?? "");
  const [status, setStatus] = useState<A2pStatus>(current.status);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["a2p.title"]}</CardTitle>
        <CardDescription>{m["a2p.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          // onSubmit, NOT the `action` prop — deliberately, and the one place
          // this panel departs from the house form pattern.
          //
          // React resets a form once its `action` resolves, including when it
          // resolves to {ok:false}. Radix's Select registers its own listener
          // for that reset (`@radix-ui/react-select`: `initialValueRef` is
          // captured on FIRST render and the listener calls `setValue` on it,
          // which fires `onValueChange`) — so the reset drives React state
          // BACKWARDS and no amount of controlling the value wins the race.
          // The live consequence: a refused save silently reverted the
          // operator's chosen status, the fields still looked filled, and
          // their next Save wrote `not_started` with the ids attached. An
          // approval a human typed landed in the database as not-approved.
          // Hit on the first real use of this panel, on Test Client One.
          //
          // Not using `action` means React never calls reset, so the listener
          // never fires. It costs us `useFormStatus` (hence useTransition and
          // a local Button rather than the shared SubmitButton).
          //
          // notifyActionResult stays, for its own reason: a Save clicked in a
          // tab that predates the current deployment REJECTS (stale
          // server-action id) rather than returning {ok:false}, and that
          // failure must reach the operator as a toast, never vanish
          // (2026-08-29, live).
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            startTransition(async () => {
              await notifyActionResult(() => action(formData), toast, {
                success: m["a2p.saved"],
                crashed: m["common.actionCrashed"],
              });
            });
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a2pBrandId">{m["a2p.brandId"]}</Label>
              <Input
                id="a2pBrandId" name="brandId"
                value={brandId} onChange={(e) => setBrandId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a2pCampaignId">{m["a2p.campaignId"]}</Label>
              <Input
                id="a2pCampaignId" name="campaignId"
                value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a2pStatus">{m["a2p.status"]}</Label>
            <Select name="status" value={status}
                    onValueChange={(v) => setStatus(v as A2pStatus)}>
              <SelectTrigger id="a2pStatus" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* DESIGN.md rule 1: every metric ships with context. "With the
                carriers" means one thing a day old and another a quarter old,
                and this item's own help says to expect days to weeks. */}
            {recordedAt ? (
              <p className="text-xs text-muted-foreground">
                {m["a2p.recorded"]} {recordedAt}
              </p>
            ) : null}
          </div>
          {/* Not the shared SubmitButton: useFormStatus only reports for a
              form driven by the `action` prop, which this one deliberately is
              not. Same disabled-while-pending behaviour and same copy. */}
          <Button type="submit" disabled={pending}>
            {pending ? m["common.saving"] : m["common.save"]}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
