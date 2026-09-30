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
import { segmentsFor, type SmsSegments } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { defaultInstantReplyBody } from "@/lib/automations/instant-reply-copy";
import type { ActionResult } from "./actions";

/**
 * What the two textareas start with. NO row yet → the defaults, so the first
 * visit shows a real, sendable message per language. A stored row → exactly
 * what it stores, read leniently (an odd stored config must be SHOWN so the
 * operator can fix it, not hidden by the parser the send path refuses it
 * with — automations-settings.tsx's formDefaults precedent). There is no
 * empty-means-default here: the send path sends the saved text VERBATIM (plus
 * the opt-out sentence every automated text carries, previewed below) and
 * the action refuses to enable with a blank, so the preview never shows a
 * string that would not send.
 */
function storedBodies(row: AutomationRow | null, brandName: string): { en: string; es: string } {
  if (!row) return { en: defaultInstantReplyBody(brandName, "en"), es: defaultInstantReplyBody(brandName, "es") };
  const cfg = row.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return { en: row.body ?? "", es: typeof cfg.bodyEs === "string" ? cfg.bodyEs : "" };
}

function countText(p: SmsSegments): string {
  return m["compose.smsSegments"].replace("{chars}", String(p.chars)).replace("{segments}", String(p.segments));
}

export function InstantReplyCard({
  automation, brandName, smsGate, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx) — only the
   *  DEFAULTS use it; a send carries the saved text, never a name. */
  brandName: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = storedBodies(automation, brandName);
  // Controlled, so the counters recompute on every keystroke — the
  // message-composer / voice-settings precedent.
  const [bodyEn, setBodyEn] = useState(stored.en);
  const [bodyEs, setBodyEs] = useState(stored.es);

  // THE PREVIEW IS THE STRING THAT SENDS: the trimmed text plus the opt-out
  // sentence `sendAutomationSms` appends unconditionally (send-sms.ts:82), in
  // the language of the body — the send passes `language: input.locale`
  // (instant-reply.ts), so the Spanish reply ends in Spanish. Each counter
  // counts that same string, so no number on this card is shorter than the
  // text a lead receives (decision B, danlo, 2026-09-22); the text-reminder
  // and confirmation cards' previews already worked this way.
  //
  // EMPTY PREVIEWS AS EMPTY. A blank text is not sent at all — the send
  // path skips it (`empty … body`), it never falls back to a default — and
  // `withOptOut("")` would preview a bare " Reply STOP to opt out." that no
  // lead ever receives. So the disclosure is added only to a text that sends.
  const previewEn = bodyEn.trim() ? withOptOut(bodyEn.trim(), "en") : "";
  const previewEs = bodyEs.trim() ? withOptOut(bodyEs.trim(), "es") : "";

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.instantReply.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="instant-reply-card">
      <CardHeader>
        <CardTitle>{m["automations.instantReply.title"]}</CardTitle>
        <CardDescription>{m["automations.instantReply.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="instant-enabled" name="enabled" defaultChecked={automation?.enabled ?? false} />
            <Label htmlFor="instant-enabled">{m["automations.instantReply.enabled"]}</Label>
          </div>
          {!smsGate.ok ? (
            // Text only: the reason a reply would be skipped, up front.
            <p className="text-xs text-muted-foreground">
              {smsGate.reason === "a2p_not_approved"
                ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="instant-body-en">{m["automations.instantReply.messageEn"]}</Label>
            <Textarea
              id="instant-body-en" name="body_en" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={bodyEn}
              onChange={(e) => setBodyEn(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.instantReply.messageEnHint"]}</p>
          </div>
          <div className="space-y-1.5">
            <SmsPreview id="instant-preview-en" label={m["automations.instantReply.previewEn"]} text={previewEn} testId="instant-reply-preview-en" />
            <p className="text-xs text-muted-foreground" data-testid="instant-reply-count-en">{countText(segmentsFor(previewEn))}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="instant-body-es">{m["automations.instantReply.messageEs"]}</Label>
            <Textarea
              id="instant-body-es" name="body_es" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={bodyEs}
              onChange={(e) => setBodyEs(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.instantReply.messageEsHint"]}</p>
          </div>
          <div className="space-y-1.5">
            <SmsPreview id="instant-preview-es" label={m["automations.instantReply.previewEs"]} text={previewEs} testId="instant-reply-preview-es" />
            <p className="text-xs text-muted-foreground" data-testid="instant-reply-count-es">{countText(segmentsFor(previewEs))}</p>
          </div>

          <SubmitButton pending={pending}>{m["automations.instantReply.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
