"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/app/(dashboard)/dashboard/accounts/submit-button";
import { NumberChip } from "@/app/(dashboard)/dashboard/accounts/[accountId]/setup/steps/step-shared";
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
 * (`isAgency` false, `action` omitted). Unlike BrandingPanel beside it on
 * both pages — which draws the SAME editable form to both audiences and
 * varies only the copy — this is the first card in either page to drop the
 * form entirely for the read-only audience, so there is no existing split
 * to point at as precedent.
 *
 * Write side shaped after SendingAddressCard/WeeklyReportCard beside it on
 * Settings: onSubmit via useFormSubmit, never the `action` prop — React
 * resets an action-prop form even when the action resolves to `{ok:false}`,
 * which would silently revert this field to the last SAVED value while it
 * still looks like what the operator just typed.
 */
export function AlertPhoneCard({
  isAgency, accountId, alertPhone, smsNotReady, action,
}: {
  isAgency: boolean;
  /** For the agency-only Notice's link to this account's own Checklist —
   *  the one place `smsNotReady` names a problem WITH a button beside it. */
  accountId: string;
  alertPhone: string | null;
  /** A number IS set, but nothing would actually send yet — A2P not
   *  approved, or no live number (`resolveSmsSender`'s own gate, read by
   *  both callers: Settings for the agency, Branding for the client via the
   *  same predicate). The AGENCY branch turns this into the carrier-facing
   *  Notice below, naming the problem beside the Checklist link that can act
   *  on it. The CLIENT branch never gets that Notice or its vocabulary — a
   *  client cannot act on carrier/registration detail — but still reads
   *  this to decide whether "Alert texts go to {value}" is true right now;
   *  a stored number the send gate is not clear for gets the qualified,
   *  future-tense sentence instead, never the present-tense claim. */
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

  // Both templates carry the same slot name for the same reason
  // setup-shell.tsx's own {steps} split does: the slot is where a live
  // element (a Link, a NumberChip) goes instead of a joined string.
  const [notReadyLead = "", notReadyTail = ""] =
    m["settings.alertPhoneNotReady"].split("{checklistLink}");
  const [clientOnLead = "", clientOnTail = ""] =
    m["settings.alertPhoneClientOn"].split("{value}");
  const [clientNotReadyLead = "", clientNotReadyTail = ""] =
    m["settings.alertPhoneClientNotReady"].split("{value}");

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
                {notReadyLead}
                <Link
                  href={`/dashboard/accounts/${accountId}/checklist`}
                  className="underline underline-offset-2"
                >
                  {m["nav.checklist"]}
                </Link>
                {notReadyTail}
              </Notice>
            )}
            <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-card-foreground">
              {!alertPhone ? (
                m["settings.alertPhoneClientOff"]
              ) : smsNotReady ? (
                <>{clientNotReadyLead}<NumberChip e164={alertPhone} />{clientNotReadyTail}</>
              ) : (
                <>{clientOnLead}<NumberChip e164={alertPhone} />{clientOnTail}</>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{m["settings.alertPhoneClientBody"]}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
