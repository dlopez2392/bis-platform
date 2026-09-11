"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";

/**
 * Agency-only by construction: rendered from the Settings page, which is
 * gated by requireAgencyOnlyAccountAccess. Modeled directly on
 * SendingAddressCard beside it — same reason for being a client component
 * (the action's error path returns a specific string this renders, rather
 * than a thrown error a server action reduces to a generic digest in
 * production), and same onSubmit-not-action form for the same reason: React
 * resets an action-prop form even when the action resolved to {ok:false},
 * which would silently revert this field to the last SAVED list while it
 * still looked like the operator's edit, right before their next Save wrote
 * it back over whatever they meant to fix.
 *
 * Unlike SendingAddressCard, the card title and the field's own label share
 * one string (m["settings.weeklyReport"]) — there is only one field here, so
 * there is nothing for a second, more precise label to disambiguate from.
 * The Label stays sr-only so that text still renders on screen exactly once,
 * not stacked.
 */
export function WeeklyReportCard({
  reportEmails, action,
}: {
  reportEmails: string[];
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData), toast, {
      success: m["settings.weeklyReportSaved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    // Anchor for the palette's settings:weekly-report entry, same pattern as
    // #sending-address and #custom-fields beside it.
    <Card id="weekly-report" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["settings.weeklyReport"]}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Label htmlFor="reportEmails" className="sr-only">{m["settings.weeklyReport"]}</Label>
          <Input
            id="reportEmails"
            name="reportEmails"
            defaultValue={reportEmails.join(", ")}
            placeholder="owner@theircompany.com, manager@theircompany.com"
          />
          <p className="text-xs text-muted-foreground">{m["settings.weeklyReportHint"]}</p>
          {reportEmails.length === 0 && (
            <p className="text-xs text-muted-foreground">{m["settings.weeklyReportOff"]}</p>
          )}
          <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
