"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/app/(dashboard)/dashboard/accounts/submit-button";
import { m } from "@/lib/messages";
import { useFormSubmit } from "@/lib/forms/use-form-submit";

export type SetAlertPhoneResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * Where a text goes when work arrives — `accounts.alert_phone`
 * (0035_alert_phone.sql). Agency-write, client-read: the migration grants
 * `authenticated` SELECT on the column but deliberately no UPDATE, and its
 * own comment says the intent plainly — "the client should SEE where their
 * alerts go even though they cannot change it." The honest way to render an
 * asymmetric permission is to keep the fact and drop the form, not to hide
 * the fact along with it — so this card always shows what the number IS,
 * and only the agency's copy of it is also a form.
 *
 * Rendered from TWO routes for that reason: the agency's Settings page
 * (`isAgency` true, `action` supplied) and the client's own Branding page
 * (`isAgency` false, `action` omitted) — the same split BrandingPanel
 * already draws across those same two pages, so there is one component and
 * one set of copy instead of a second copy of the markup to drift.
 *
 * Write side shaped after SendingAddressCard/WeeklyReportCard beside it on
 * Settings: onSubmit via useFormSubmit, never the `action` prop — React
 * resets an action-prop form even when the action resolves to `{ok:false}`,
 * which would silently revert this field to the last SAVED value while it
 * still looks like what the operator just typed.
 */
export function AlertPhoneCard({
  isAgency, alertPhone, smsNotReady, action,
}: {
  isAgency: boolean;
  alertPhone: string | null;
  /** Agency-only: a number IS set, but nothing would actually send yet —
   *  A2P not approved, or no live number (`resolveSmsSender`'s own gate).
   *  Never computed for a client: only the agency's own Checklist can act
   *  on it, so surfacing it there would name a problem with no button next
   *  to it. */
  smsNotReady?: boolean;
  /** Present only on the agency's editable card; omitted entirely renders
   *  the read-only view. */
  action?: (formData: FormData) => Promise<SetAlertPhoneResult>;
}) {
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    if (!action) return;
    let result: SetAlertPhoneResult;
    try {
      result = await action(formData);
    } catch {
      toast.error(m["common.actionCrashed"]);
      return;
    }
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(m["settings.alertPhoneSaved"]);
    // Help, not a guard — the save already went through. The real guard
    // (refusesAlertLoop, lib/sms/sender.ts) refuses the SEND, at the only
    // moment that condition is current; this just says so now instead of
    // leaving the operator to notice a text that never arrived.
    if (result.warning) toast.warning(result.warning);
  });

  return (
    <Card id="alert-phone" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["settings.alertPhone"]}</CardTitle>
      </CardHeader>
      <CardContent>
        {isAgency ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <Label htmlFor="alertPhone" className="sr-only">{m["settings.alertPhone"]}</Label>
            <Input
              id="alertPhone"
              name="alertPhone"
              type="tel"
              defaultValue={alertPhone ?? ""}
              placeholder={m["settings.alertPhonePlaceholder"]}
            />
            <p className="text-xs text-muted-foreground">{m["settings.alertPhoneHint"]}</p>
            {!alertPhone && (
              <p className="text-xs text-muted-foreground">{m["settings.alertPhoneOff"]}</p>
            )}
            {alertPhone && smsNotReady && (
              <Notice tone="warn" className="text-foreground">
                {m["settings.alertPhoneNotReady"]}
              </Notice>
            )}
            <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-card-foreground">
              {alertPhone
                ? m["settings.alertPhoneClientOn"].replace("{value}", alertPhone)
                : m["settings.alertPhoneClientOff"]}
            </p>
            <p className="text-xs text-muted-foreground">{m["settings.alertPhoneClientBody"]}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
