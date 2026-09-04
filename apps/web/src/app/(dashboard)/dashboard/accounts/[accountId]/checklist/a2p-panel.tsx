"use client";

import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
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
  registration, action,
}: {
  registration: A2pRegistration | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  // A missing row is not a state the operator can be in on this page — the
  // account had to exist to reach it — but the read is nullable, so this
  // renders the same thing a fresh account shows rather than crashing.
  const current = registration ?? { brandId: null, campaignId: null, status: "not_started" as const };

  return (
    <Card id="a2p-registration" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["a2p.title"]}</CardTitle>
        <CardDescription>{m["a2p.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          // notifyActionResult, not a naked await: a Save clicked in a tab that
          // predates the current deployment REJECTS (stale server-action id)
          // rather than returning {ok:false}, and that failure must reach the
          // operator as a toast, never vanish (2026-08-29, live).
          action={(formData) => notifyActionResult(() => action(formData), toast, {
            success: m["a2p.saved"],
            crashed: m["common.actionCrashed"],
          })}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a2pBrandId">{m["a2p.brandId"]}</Label>
              <Input
                id="a2pBrandId" name="brandId"
                defaultValue={current.brandId ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a2pCampaignId">{m["a2p.campaignId"]}</Label>
              <Input
                id="a2pCampaignId" name="campaignId"
                defaultValue={current.campaignId ?? ""}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a2pStatus">{m["a2p.status"]}</Label>
            <Select name="status" defaultValue={current.status}>
              <SelectTrigger id="a2pStatus" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
