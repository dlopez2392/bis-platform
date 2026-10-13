"use client";

import { spanishIsStale } from "@bis/db/spanish-box";
import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SmsPreview } from "@/components/sms-preview";
import { SpanishBodyField } from "@/components/spanish-body-field";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { composeAppointmentConfirm } from "@/lib/automations/appointment-confirm-copy";
import { SMS_REMINDER_PREVIEW_INSTANT } from "@/lib/automations/sms-reminder-copy";
import type { ActionResult } from "./actions";

export function AppointmentConfirmCard({
  automation, brandName, accountTimezone, smsGate, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  accountTimezone: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState(automation?.body ?? "");

  // The FIXED preview instant the text reminder already uses — chosen at the
  // widest common width formatWhen produces, so the count the operator
  // approves is not optimistic and does not drift day to day. Reused rather
  // than copied: two preview instants would be two things to keep in step.
  const when = formatWhen(SMS_REMINDER_PREVIEW_INSTANT, safeZone(accountTimezone, "UTC"));
  // THROUGH `withOptOut`, and that is the whole message, not a flourish:
  // `sendAutomationSms` appends the disclosure unconditionally (send-sms.ts's
  // `withOptOut(input.body, input.language)`) because it is a property of the
  // SEND PATH, not of any recipe's copy. Counting the composed body alone
  // reports a number no customer receives and no client is billed — for this
  // recipe, 160 + len(brandName) septets are billed against 137 + len(brandName)
  // shown, so there is no company name for which it is right. The `<output>`
  // shows the same disclosed string it counts: opt-out.ts's own rule is that
  // an operator must never read a shorter message than the customer got.
  // `withOptOut` is idempotent on a STOP instruction, so an operator who wrote the
  // sentence themselves is not double-counted.
  const previewText = withOptOut(composeAppointmentConfirm(brandName, when, body));
  const preview = segmentsFor(previewText);

  // C14/spec §12.3's staleness rule (`spanishIsStale`, packages/db/src/spanish-box.ts, through
  // the import-free subpath so the barrel's database client stays out of the browser bundle).
  // Reads the STORED row (plan deviation 5), not live state: a warning that flickered while
  // typing would describe an edit not yet saved.
  const storedBodyEs = automation?.body_es ?? null;
  const spanishStale = spanishIsStale({
    body: automation?.body ?? "", bodyEs: storedBodyEs, bodyEsBasis: automation?.body_es_basis ?? null,
  });

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.appointmentConfirm.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="appointment-confirm-card">
      <CardHeader>
        <CardTitle>{m["automations.appointmentConfirm.title"]}</CardTitle>
        <CardDescription>{m["automations.appointmentConfirm.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="confirm-enabled" name="enabled" defaultChecked={automation?.enabled ?? false} />
            <Label htmlFor="confirm-enabled">{m["automations.appointmentConfirm.enabled"]}</Label>
          </div>
          {!smsGate.ok ? (
            // Text only: the reason a confirmation would be skipped, up front.
            <p className="text-xs text-muted-foreground">
              {smsGate.reason === "a2p_not_approved"
                ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="confirm-body">{m["automations.appointmentConfirm.message"]}</Label>
              <Textarea
                id="confirm-body" name="body" rows={2} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={body}
                className="min-h-11 md:min-h-8"
                onChange={(e) => setBody(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{m["automations.appointmentConfirm.messageHint"]}</p>
            </div>
            {/* Plan deviation 4: this recipe's "our Spanish default" is the
                empty string — its English has no default either. */}
            <SpanishBodyField
              idPrefix="confirm"
              stored={{ bodyEs: storedBodyEs, stale: spanishStale }}
              defaultEs=""
              composeEs={(text) => withOptOut(
                composeAppointmentConfirm(brandName, formatWhen(SMS_REMINDER_PREVIEW_INSTANT, safeZone(accountTimezone, "UTC"), "es"), text, "es"),
                "es",
              )}
              sms
            />
          </div>

          {/* The one shared preview box (components/sms-preview.tsx), the
              same one the text-reminder and instant-reply cards render: two
              cards side by side must not render the same idea two ways. */}
          <div className="space-y-1.5">
            <SmsPreview
              id="confirm-preview"
              label={m["automations.appointmentConfirm.preview"]}
              text={previewText}
              testId="appointment-confirm-preview"
            />
            <p className="text-xs text-muted-foreground" data-testid="appointment-confirm-sms-count">
              {m["compose.smsSegments"]
                .replace("{chars}", String(preview.chars))
                .replace("{segments}", String(preview.segments))}
            </p>
          </div>

          <SubmitButton pending={pending}>{m["automations.appointmentConfirm.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
