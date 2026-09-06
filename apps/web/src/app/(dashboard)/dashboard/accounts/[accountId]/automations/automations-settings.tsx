"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow, ReviewRequestChannel } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { composeReviewRequestSms, defaultReviewRequestBody } from "@/lib/automations/review-request-copy";
import type { ActionResult } from "./actions";

type StoredForm = { enabled: boolean; channel: ReviewRequestChannel; reviewUrl: string; body: string };

/**
 * What the form shows for a stored row. Reads the RAW jsonb leniently on
 * purpose: an invalid stored link must be SHOWN so the operator can fix it,
 * not hidden by the parser the pass (correctly) refuses it with.
 */
function formDefaults(row: AutomationRow | null): StoredForm {
  const cfg = row?.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return {
    enabled: row?.enabled ?? false,
    channel: cfg.channel === "sms" ? "sms" : "email",
    reviewUrl: typeof cfg.reviewUrl === "string" ? cfg.reviewUrl : "",
    body: row?.body ?? "",
  };
}

const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none "
  + "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function AutomationsSettings({
  automation, brandName, smsGate, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx) — what
   *  the default body previews here is the string that sends. */
  brandName: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = formDefaults(automation);
  // Controlled, so the counter recomputes on every keystroke — the
  // message-composer / voice-settings precedent. The Select stays
  // uncontrolled (defaultValue + onValueChange) for the reason in
  // lib/forms/use-form-submit.ts; this state only redraws the preview.
  const [channel, setChannel] = useState<ReviewRequestChannel>(stored.channel);
  const [reviewUrl, setReviewUrl] = useState(stored.reviewUrl);
  const [body, setBody] = useState(stored.body);

  // THE COUNTER COUNTS BODY PLUS LINK, through the ONE function the sender
  // uses, so what the operator approves is what is billed. An empty body
  // previews the live default (empty-means-default, as the column contract
  // says), and an empty link previews the body alone.
  const previewBody = body || defaultReviewRequestBody(brandName);
  const preview = segmentsFor(composeReviewRequestSms(previewBody, reviewUrl));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.review.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["automations.review.title"]}</CardTitle>
        <CardDescription>{m["automations.review.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="enabled" name="enabled" defaultChecked={stored.enabled} />
            <Label htmlFor="enabled">{m["automations.review.enabled"]}</Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="channel">{m["automations.review.channel"]}</Label>
            <Select
              name="channel" defaultValue={stored.channel}
              onValueChange={(v) => setChannel(v === "sms" ? "sms" : "email")}
            >
              <SelectTrigger id="channel" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{m["automations.review.channel.email"]}</SelectItem>
                <SelectItem value="sms">{m["automations.review.channel.sms"]}</SelectItem>
              </SelectContent>
            </Select>
            {channel === "sms" && !smsGate.ok ? (
              // The composer's own copy for the same two refusals — the pass
              // will skip and count, never fall back to email, so say so here.
              <p className="text-xs text-muted-foreground">
                {smsGate.reason === "a2p_not_approved"
                  ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review_url">{m["automations.review.url"]}</Label>
            <Input
              id="review_url" name="review_url" type="url" inputMode="url"
              value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)}
              placeholder="https://g.page/r/.../review"
            />
            <p className="text-xs text-muted-foreground">{m["automations.review.urlHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">{m["automations.review.message"]}</Label>
            <textarea
              id="body" name="body" rows={3} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultReviewRequestBody(brandName)}
              className={TEXTAREA}
            />
            <p className="text-xs text-muted-foreground">{m["automations.review.messageHint"]}</p>
            {channel === "sms" ? (
              <p className="text-xs text-muted-foreground" data-testid="review-sms-count">
                {m["compose.smsSegments"]
                  .replace("{chars}", String(preview.chars))
                  .replace("{segments}", String(preview.segments))}
              </p>
            ) : null}
          </div>

          <SubmitButton pending={pending}>{m["automations.review.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
