"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  QUOTE_FOLLOWUP_MIN_QUIET_DAYS, QUOTE_FOLLOWUP_MAX_QUIET_DAYS, QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS,
  type AutomationRow, type QuoteFollowupChannel,
} from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { defaultQuoteFollowupBody } from "@/lib/automations/quote-followup-copy";
import type { ActionResult } from "./actions";

/** Flattened across pipelines by the page; `label` already carries the
 *  "<pipeline> · <stage>" prefix when the account has more than one. */
export type StageOption = { id: string; label: string };

type StoredForm = { enabled: boolean; stageId: string; quietDays: number; channel: QuoteFollowupChannel; body: string };

/** Lenient on the raw jsonb, like the sibling cards: a stored value the pass
 *  refuses must still be SHOWN so the operator can fix it. The only thing a
 *  junk `quietDays` cannot do is become the number in the box — the input
 *  needs something, and the platform default is the honest guess. */
function formDefaults(row: AutomationRow | null): StoredForm {
  const cfg = row?.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return {
    enabled: row?.enabled ?? false,
    stageId: typeof cfg.stageId === "string" ? cfg.stageId : "",
    quietDays: typeof cfg.quietDays === "number" && Number.isFinite(cfg.quietDays)
      ? cfg.quietDays : QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS,
    channel: cfg.channel === "sms" ? "sms" : "email",
    body: row?.body ?? "",
  };
}

/**
 * The only PIPELINE-driven recipe, and the only card that has to say out loud
 * what does NOT happen: nothing in this product creates an opportunity on its
 * own. A deal reaches the stage this watches because someone on the team put
 * it there, and the description says so in the operator's words rather than
 * leaving them to infer a trigger that does not exist.
 *
 * THE VANISHED STAGE lives here too. A normal tick cannot log it — the
 * due-list filters on `stage_id`, so a deleted stage yields no row and there
 * is no subject to write an `automation_log` line against — so this card,
 * which can see the account's real stages, is the ONE place an operator can
 * be told their automation has stopped matching anything.
 */
export function QuoteFollowupCard({
  automation, brandName, smsGate, stages, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  smsGate: SmsGate;
  stages: StageOption[];
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = formDefaults(automation);
  const [channel, setChannel] = useState<QuoteFollowupChannel>(stored.channel);
  const [body, setBody] = useState(stored.body);

  const hasStages = stages.length > 0;
  // A stored id that is not among the account's stages means the operator
  // deleted or replaced it. The select is left UNSET rather than silently
  // showing a neighbouring stage as if it were the configured one.
  const storedStageExists = stored.stageId !== "" && stages.some((s) => s.id === stored.stageId);
  const stageMissing = stored.stageId !== "" && !storedStageExists;

  // THE DISCLOSED BODY: `sendAutomationSms` appends `withOptOut`
  // unconditionally (send-sms.ts:82), so counting the composed body alone
  // reports a number no customer receives and no client is billed for.
  // `withOptOut` is idempotent on `\bstop\b`, so an operator who wrote the
  // sentence themselves is not counted twice.
  const previewBody = body.trim() || defaultQuoteFollowupBody(brandName);
  const preview = segmentsFor(withOptOut(previewBody));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.quoteFollowup.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="quote-followup-card">
      <CardHeader>
        <CardTitle>{m["automations.quoteFollowup.title"]}</CardTitle>
        <CardDescription>{m["automations.quoteFollowup.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="quote-followup-enabled" name="enabled" defaultChecked={stored.enabled} />
            <Label htmlFor="quote-followup-enabled">{m["automations.quoteFollowup.enabled"]}</Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quote-followup-stage">{m["automations.quoteFollowup.stage"]}</Label>
            {/* AN ERROR STATE, not a tip. The recipe is ON and pointed at a
                stage that no longer exists, so it is sending nothing and the
                operator has to act. It used to render in the same
                `text-xs text-muted-foreground` as the three ordinary hints
                below, with no `role="alert"` — indistinguishable from advice
                (design review I2). `Notice` is the app's one status banner:
                `role="alert"`, the `--warn-bg` ground, tokens only.
                The testid stays on it; `automations-b.spec.ts:243` reads it.
                `noStages` below deliberately stays muted — an account with no
                pipeline at all is a true EMPTY state, not a broken one. */}
            {stageMissing ? (
              <Notice tone="warn" data-testid="quote-followup-stage-missing">
                {m["automations.quoteFollowup.stageMissing"]}
              </Notice>
            ) : null}
            {hasStages ? (
              <Select name="stage_id" defaultValue={storedStageExists ? stored.stageId : undefined}>
                <SelectTrigger id="quote-followup-stage" className="w-full">
                  <SelectValue placeholder={m["automations.quoteFollowup.stagePlaceholder"]} />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="quote-followup-no-stages">
                {m["automations.quoteFollowup.noStages"]}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{m["automations.quoteFollowup.stageHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quote-followup-days">{m["automations.quoteFollowup.quietDays"]}</Label>
            {/* THE CONSTANTS, never the literals 1/30/3: the input and
                `parseQuoteFollowupConfig` must not be able to disagree. What
                `max` buys is narrow — the browser refuses to fire `submit` at
                all when the value is out of range, so the server's
                `quietDaysInvalid` message is unreachable from a normal
                keyboard, which is why the parser's refusal is proved in
                actions.test.ts and never in Playwright. */}
            <Input
              id="quote-followup-days" name="quiet_days" type="number" className="w-24"
              min={QUOTE_FOLLOWUP_MIN_QUIET_DAYS} max={QUOTE_FOLLOWUP_MAX_QUIET_DAYS} step={1}
              defaultValue={stored.quietDays}
            />
            <p className="text-xs text-muted-foreground">{m["automations.quoteFollowup.quietDaysHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quote-followup-channel">{m["automations.quoteFollowup.channel"]}</Label>
            <Select
              name="channel" defaultValue={stored.channel}
              onValueChange={(v) => setChannel(v === "sms" ? "sms" : "email")}
            >
              <SelectTrigger id="quote-followup-channel" className="w-full"><SelectValue /></SelectTrigger>
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
            <Label htmlFor="quote-followup-body">{m["automations.quoteFollowup.message"]}</Label>
            <Textarea
              id="quote-followup-body" name="body" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultQuoteFollowupBody(brandName)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.quoteFollowup.messageHint"]}</p>
            {channel === "sms" ? (
              <>
                <p className="text-xs text-muted-foreground" data-testid="quote-followup-sms-count">
                  {m["compose.smsSegments"]
                    .replace("{chars}", String(preview.chars))
                    .replace("{segments}", String(preview.segments))}
                </p>
                {/* The count above is of the DISCLOSED body, and those 23
                    characters appear nowhere else on this page — the message
                    box shows the undisclosed default (design review I3). Its
                    own paragraph rather than more text inside the counter's,
                    so the counter's testid still reads as one clean string.
                    Inside the `sms` branch on purpose: an emailed quote
                    follow-up has no opt-out sentence and no count. */}
                <p className="text-xs text-muted-foreground">{m["automations.optOutCounted"]}</p>
              </>
            ) : null}
          </div>

          <SubmitButton pending={pending} disabled={!hasStages}>
            {m["automations.quoteFollowup.save"]}
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
