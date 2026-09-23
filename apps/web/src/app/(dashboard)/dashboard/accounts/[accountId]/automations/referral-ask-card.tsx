"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { AutomationRow, ReferralAskChannel } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { defaultReferralAskBody } from "@/lib/automations/referral-ask-copy";
import type { ActionResult } from "./actions";

type StoredForm = { enabled: boolean; channel: ReferralAskChannel; body: string };

/** Lenient on the raw jsonb, like the review and nudge cards: a stored value
 *  the pass refuses must still be SHOWN so the operator can fix it. */
function formDefaults(row: AutomationRow | null): StoredForm {
  const cfg = row?.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return {
    enabled: row?.enabled ?? false,
    channel: cfg.channel === "sms" ? "sms" : "email",
    body: row?.body ?? "",
  };
}

/**
 * Which of the two things the referral EMAIL cannot go without is missing
 * (B21) — one sentence either way, `{settingsLink}` where the catalogue says
 * so. The reactivation card's two voices: `missing*` when the row is saved ON
 * by email (something configured is broken — emails that should be going
 * are not), `beforeOn*` otherwise (nothing is broken yet). Null when nothing
 * is missing.
 */
function missingKey(missing: { mailingAddress: boolean; replyTo: boolean }, brokenNow: boolean) {
  if (missing.mailingAddress && missing.replyTo) {
    return brokenNow ? "automations.referral.missingBoth" as const : "automations.referral.beforeOnBoth" as const;
  }
  if (missing.mailingAddress) {
    return brokenNow
      ? "automations.referral.missingMailingAddress" as const
      : "automations.referral.beforeOnMailingAddress" as const;
  }
  if (missing.replyTo) {
    return brokenNow ? "automations.referral.missingReplyTo" as const : "automations.referral.beforeOnReplyTo" as const;
  }
  return null;
}

export function ReferralAskCard({
  automation, brandName, accountId, smsGate, missing, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  /** For the Settings link in the missing-address/reply-to sentence. */
  accountId: string;
  smsGate: SmsGate;
  /** `missingForMarketingEmail` over the account's address and reply-to
   *  (page.tsx) — the judgement the save refuses on and the pass skips on,
   *  for the EMAIL channel only (B21). `true` = missing. */
  missing: { mailingAddress: boolean; replyTo: boolean };
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = formDefaults(automation);
  const [channel, setChannel] = useState<ReferralAskChannel>(stored.channel);
  const [body, setBody] = useState(stored.body);

  // AMBER only for the row AS SAVED — on, by email — because that is the
  // only state in which emails that should be going are not. Otherwise the
  // muted line, and only while the select shows EMAIL: a text needs neither,
  // so an operator on the text channel is told nothing.
  const brokenNow = stored.enabled && stored.channel === "email";
  const key = brokenNow || channel === "email" ? missingKey(missing, brokenNow) : null;
  const [missingLead = "", missingTail = ""] = key ? m[key].split("{settingsLink}") : [];
  // Settings, like the reactivation card's link: this page is agency-only and
  // the agency edits branding there.
  const settingsLink = (
    <Link href={`/dashboard/accounts/${accountId}/settings`} className="underline underline-offset-2">
      {m["nav.settings"]}
    </Link>
  );

  // NO COMPOSER AND NO LINK: this recipe asks for a name, never a rating, and
  // there is nowhere for a link to point — the pass sends `body` verbatim.
  // THROUGH `withOptOut`, though, because `sendAutomationSms` appends the
  // disclosure unconditionally (send-sms.ts:82): counting the composed body
  // alone reports a number no customer receives and no client is billed for.
  // For a company name of ordinary length the disclosed text crosses into a
  // second segment where the undisclosed one still reads "1 message".
  // `withOptOut` is idempotent on a STOP instruction, so an operator who wrote the
  // sentence themselves is not counted twice.
  const previewBody = body.trim() || defaultReferralAskBody(brandName);
  const preview = segmentsFor(withOptOut(previewBody));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.referral.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="referral-ask-card">
      <CardHeader>
        <CardTitle>{m["automations.referral.title"]}</CardTitle>
        <CardDescription>{m["automations.referral.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* FIRST, above the switch, like the reactivation card's: the save
              refuses to turn the email channel on without these, so the
              operator reads why before reaching for the checkbox. */}
          {key && brokenNow ? (
            <Notice tone="warn" className="text-foreground" data-testid="referral-ask-missing">
              {missingLead}{settingsLink}{missingTail}
            </Notice>
          ) : key ? (
            <p className="text-xs text-muted-foreground" data-testid="referral-ask-missing">
              {missingLead}{settingsLink}{missingTail}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Checkbox id="referral-enabled" name="enabled" defaultChecked={stored.enabled} />
            <Label htmlFor="referral-enabled">{m["automations.referral.enabled"]}</Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="referral-channel">{m["automations.referral.channel"]}</Label>
            <Select
              name="channel" defaultValue={stored.channel}
              onValueChange={(v) => setChannel(v === "sms" ? "sms" : "email")}
            >
              <SelectTrigger id="referral-channel" className="w-full"><SelectValue /></SelectTrigger>
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
            <Label htmlFor="referral-body">{m["automations.referral.message"]}</Label>
            <Textarea
              id="referral-body" name="body" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultReferralAskBody(brandName)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.referral.messageHint"]}</p>
            {channel === "sms" ? (
              <>
                <p className="text-xs text-muted-foreground" data-testid="referral-ask-sms-count">
                  {m["compose.smsSegments"]
                    .replace("{chars}", String(preview.chars))
                    .replace("{segments}", String(preview.segments))}
                </p>
                {/* The count above is of the DISCLOSED body, and those 23
                    characters appear nowhere else on this page — the message
                    box shows the undisclosed default (design review I3). Its
                    own paragraph rather than more text inside the counter's,
                    so the counter's testid still reads as one clean string.
                    Inside the `sms` branch on purpose: an emailed referral
                    ask has no opt-out sentence and no count. */}
                <p className="text-xs text-muted-foreground">{m["automations.optOutCounted"]}</p>
              </>
            ) : null}
          </div>

          <SubmitButton pending={pending}>{m["automations.referral.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
