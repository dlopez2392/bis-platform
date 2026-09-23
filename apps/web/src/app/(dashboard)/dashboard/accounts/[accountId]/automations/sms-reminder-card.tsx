"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SmsPreview } from "@/components/sms-preview";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { safeZone, formatWhen } from "@/lib/booking/time";
import {
  composeSmsReminder, defaultSmsReminderBody, SMS_REMINDER_PREVIEW_INSTANT,
} from "@/lib/automations/sms-reminder-copy";
import type { ActionResult } from "./actions";

export function SmsReminderCard({
  automation, brandName, accountTimezone, smsGate, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  /** For the sample time in the preview; a real send uses the booker's zone. */
  accountTimezone: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState(automation?.body ?? "");

  // THE PREVIEW IS THE SENT STRING — lead with a sample time, then the
  // closing line, then the opt-out disclosure — through the ONE composer the
  // pass uses AND the same `withOptOut` the send path applies, so the count
  // the operator approves is the count that sends (±2 characters of date
  // width). The disclosure was missing here until part B: it is added
  // unconditionally in `sendAutomationSms` because it belongs to the SEND
  // PATH rather than to any recipe's copy, and leaving it out of the count
  // under-reported by 23 septets. Harmless for the default (122 → 145, still
  // one segment) and not harmless at all for a real operator body — 150
  // composed reads as one segment where 173 disclosed is two. `withOptOut` is
  // idempotent on `\bstop\b`, so an operator who wrote the sentence
  // themselves is not double-counted.
  const when = formatWhen(SMS_REMINDER_PREVIEW_INSTANT, safeZone(accountTimezone, "UTC"));
  const composed = withOptOut(composeSmsReminder(brandName, when, body.trim() || defaultSmsReminderBody()));
  const preview = segmentsFor(composed);

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.smsReminder.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="sms-reminder-card">
      <CardHeader>
        <CardTitle>{m["automations.smsReminder.title"]}</CardTitle>
        <CardDescription>{m["automations.smsReminder.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="smsrem-enabled" name="enabled" defaultChecked={automation?.enabled ?? false} />
            <Label htmlFor="smsrem-enabled">{m["automations.smsReminder.enabled"]}</Label>
          </div>
          {!smsGate.ok ? (
            // Text only: the reason a text reminder would be skipped, up front.
            <p className="text-xs text-muted-foreground">
              {smsGate.reason === "a2p_not_approved"
                ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="smsrem-body">{m["automations.smsReminder.message"]}</Label>
            <Textarea
              id="smsrem-body" name="body" rows={2} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultSmsReminderBody()}
            />
            <p className="text-xs text-muted-foreground">{m["automations.smsReminder.messageHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <SmsPreview id="smsrem-preview" label={m["automations.smsReminder.preview"]} text={composed} testId="sms-reminder-preview" />
            <p className="text-xs text-muted-foreground" data-testid="sms-reminder-count">
              {m["compose.smsSegments"]
                .replace("{chars}", String(preview.chars))
                .replace("{segments}", String(preview.segments))}
            </p>
          </div>

          <SubmitButton pending={pending}>{m["automations.smsReminder.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
