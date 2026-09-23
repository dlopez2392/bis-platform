"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { A2pRegistration, A2pStatus } from "@bis/db";

/**
 * What has to be asked of the CLIENT before anything can be submitted, in the
 * order the Telnyx brand form asks for it. The full procedure — portal
 * navigation, the sole-proprietor OTP flow, the fees, what gets a campaign
 * rejected — stays in docs/runbooks/a2p-registration.md; only this list is
 * duplicated into the UI, because it is the one part whose cost is paid by
 * someone else's calendar. Going back to a client a second time for one more
 * field loses a week.
 */
const GATHER_ITEMS: readonly string[] = [
  m["a2p.gather.legalName"],
  m["a2p.gather.dba"],
  m["a2p.gather.ein"],
  m["a2p.gather.address"],
  m["a2p.gather.website"],
  m["a2p.gather.vertical"],
  m["a2p.gather.contact"],
  m["a2p.gather.optIn"],
];

/** The first click of the procedure. Deep-linked to Brands rather than the
 *  portal root, matching the checklist item's own href. */
const TELNYX_BRANDS_URL = "https://portal.telnyx.com/#/messaging-10dlc/brands";

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

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData), toast, {
      success: m["a2p.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["a2p.title"]}</CardTitle>
        <CardDescription>{m["a2p.body"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Reference, not status — so a plain nested panel (ladder step 2),
            never a Notice: that component carries role="alert", and a list of
            paperwork announced as an alert every time the page loads is a
            screen reader interrupting for nothing.

            Keyed on the RECORDED status, not the `status` state above: driving
            it from the select would make the list vanish mid-edit, before the
            operator has saved anything, and reappear if they changed their
            mind. Hidden once the filing is with the carriers, since there is
            nothing left to collect; shown again on `rejected`, because a
            rejection usually means one of these was wrong. */}
        {current.status === "not_started" || current.status === "rejected" ? (
          <div className="rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-medium text-card-foreground">{m["a2p.gather.title"]}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m["a2p.gather.body"]}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {GATHER_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <a
              href={TELNYX_BRANDS_URL} target="_blank" rel="noreferrer"
              className="mt-3 flex w-fit items-center gap-1 text-xs text-primary underline"
            >
              <ExternalLink className="size-3" aria-hidden />
              {m["a2p.gather.link"]}
            </a>
          </div>
        ) : null}
        <form
          // onSubmit via useFormSubmit, NOT the `action` prop. This is the
          // panel the defect was FOUND on — a refused save silently reverted
          // the operator's chosen status, the fields still looked filled, and
          // the retry wrote `not_started` with the ids attached, so an
          // approval a human typed landed in the database as not-approved.
          // The mechanism, and why controlling the value is not enough, is
          // documented once in lib/forms/use-form-submit.ts.
          //
          // notifyActionResult stays, for its own reason: a Save clicked in a
          // tab that predates the current deployment REJECTS (stale
          // server-action id) rather than returning {ok:false}, and that
          // failure must reach the operator as a toast, never vanish
          // (2026-08-29, live).
          onSubmit={onSubmit}
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
          <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
