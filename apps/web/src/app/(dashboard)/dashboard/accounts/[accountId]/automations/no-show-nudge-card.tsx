"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow, NoShowNudgeChannel } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { composeNoShowNudgeSms, defaultNoShowNudgeBody } from "@/lib/automations/no-show-nudge-copy";
import type { ActionResult } from "./actions";

type StoredForm = { enabled: boolean; channel: NoShowNudgeChannel; body: string };

/** Lenient on the raw jsonb, like the review card: a stored value the pass
 *  refuses must still be SHOWN so the operator can fix it. */
function formDefaults(row: AutomationRow | null): StoredForm {
  const cfg = row?.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return {
    enabled: row?.enabled ?? false,
    channel: cfg.channel === "sms" ? "sms" : "email",
    body: row?.body ?? "",
  };
}

export function NoShowNudgeCard({
  automation, brandName, smsGate, bookingUrl, calendarEnabled, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  smsGate: SmsGate;
  /** `${origin}/b/${calendar.public_id}` — the very link the pass appends. */
  bookingUrl: string;
  /** The public page's switch; the pass skips while it is off. */
  calendarEnabled: boolean;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = formDefaults(automation);
  const [channel, setChannel] = useState<NoShowNudgeChannel>(stored.channel);
  const [body, setBody] = useState(stored.body);

  // THE COUNTER COUNTS BODY PLUS LINK PLUS THE OPT-OUT SENTENCE, through the
  // ONE function the pass uses (composeNoShowNudgeSms → withTrailingLink),
  // with the real link, and through the SAME `withOptOut` the send path
  // applies unconditionally (send-sms.ts:82; English, because the pass
  // passes no `language`). Without it the counter under-reported by 23
  // septets, and "Valley Air Conditioning" read "1 message" while billing
  // two (decision B, danlo, 2026-09-22). Idempotent on `\bstop\b`, so an
  // operator who wrote the sentence themselves is not counted twice.
  const previewBody = body.trim() || defaultNoShowNudgeBody(brandName);
  const preview = segmentsFor(withOptOut(composeNoShowNudgeSms(previewBody, bookingUrl)));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.noShow.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="no-show-nudge-card">
      <CardHeader>
        <CardTitle>{m["automations.noShow.title"]}</CardTitle>
        <CardDescription>{m["automations.noShow.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="noshow-enabled" name="enabled" defaultChecked={stored.enabled} />
            <Label htmlFor="noshow-enabled">{m["automations.noShow.enabled"]}</Label>
          </div>
          {!calendarEnabled ? (
            <p className="text-xs text-muted-foreground">{m["automations.noShow.calendarOff"]}</p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="noshow-channel">{m["automations.noShow.channel"]}</Label>
            <Select
              name="channel" defaultValue={stored.channel}
              onValueChange={(v) => setChannel(v === "sms" ? "sms" : "email")}
            >
              <SelectTrigger id="noshow-channel" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{m["automations.channel.email"]}</SelectItem>
                <SelectItem value="sms">{m["automations.channel.sms"]}</SelectItem>
              </SelectContent>
            </Select>
            {channel === "sms" && !smsGate.ok ? (
              <p className="text-xs text-muted-foreground">
                {smsGate.reason === "a2p_not_approved"
                  ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="noshow-body">{m["automations.noShow.message"]}</Label>
            <Textarea
              id="noshow-body" name="body" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultNoShowNudgeBody(brandName)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.noShow.messageHint"]}</p>
            {bookingUrl ? (
              <p className="text-xs text-muted-foreground" data-testid="no-show-link">
                {m["automations.noShow.linkHint"].replace("{link}", () => bookingUrl)}
              </p>
            ) : null}
            {channel === "sms" ? (
              <>
                <p className="text-xs text-muted-foreground" data-testid="no-show-sms-count">
                  {m["compose.smsSegments"]
                    .replace("{chars}", String(preview.chars))
                    .replace("{segments}", String(preview.segments))}
                </p>
                {/* The count above includes the disclosure, which appears
                    nowhere else on this page. Its own paragraph, so the
                    counter's testid stays one clean string; `sms` branch
                    only, because an emailed nudge carries no opt-out
                    sentence (referral-ask-card.tsx). */}
                <p className="text-xs text-muted-foreground">{m["automations.optOutCounted"]}</p>
              </>
            ) : null}
          </div>

          <SubmitButton pending={pending}>{m["automations.noShow.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
