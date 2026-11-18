"use client";

import { spanishIsStale } from "@bis/db/spanish-box";
import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow, ReviewRequestChannel } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "../../submit-button";
import { SpanishBodyField } from "@/components/spanish-body-field";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { composeReviewRequestSms, defaultReviewRequestBody } from "@/lib/automations/review-request-copy";
import type { ActionResult } from "./actions";

type StoredForm = { enabled: boolean; channel: ReviewRequestChannel; reviewUrl: string; body: string; checkin: boolean };

/**
 * The address "Open link" opens: http(s) only, normalised (`href`, as the pass sends it), else null. Never the raw
 * field value: a `javascript:` or `data:` string typed into the box must not become an anchor's href. Local, not the
 * pass's parser: that one lives in the barrel whose database client must stay out of this client bundle.
 */
function openableHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

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
    // Only the boolean true is on, as the pass's parser reads it (F-072, plan D5).
    checkin: cfg.checkin === true,
  };
}

/**
 * The message fields (body and its Spanish twin). Hidden, not unmounted, while the check-in is in play: ON and by
 * EMAIL. On Text the check-in is neither drawn nor submitted, so the box is back. Its own component so the rule can be
 * driven with every (switch, channel) pair, which a static render of the card cannot do (the channel is client state).
 */
export function ReviewMessageFields({ checkin, channel, children }: {
  checkin: boolean; channel: ReviewRequestChannel; children?: React.ReactNode;
}) {
  const hidden = checkin && channel === "email";
  return (
    <div data-testid="review-message-fields" hidden={hidden} className={hidden ? undefined : "grid gap-4 md:grid-cols-2"}>
      {children}
    </div>
  );
}

export function AutomationsSettings({
  automation, brandName, smsGate, saveAction, counts,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx) — what
   *  the default body previews here is the string that sends. */
  brandName: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
  /** The check-in counts line, rendered on the server (checkin-counts-line.tsx, inside Suspense) and drawn under the form. */
  counts?: React.ReactNode;
}) {
  const stored = formDefaults(automation);
  // Controlled, so the counter recomputes on every keystroke — the
  // message-composer / voice-settings precedent. The Select stays
  // uncontrolled (defaultValue + onValueChange) for the reason in
  // lib/forms/use-form-submit.ts; this state only redraws the preview.
  const [channel, setChannel] = useState<ReviewRequestChannel>(stored.channel);
  const [reviewUrl, setReviewUrl] = useState(stored.reviewUrl);
  const [body, setBody] = useState(stored.body);
  // F-072 (plan D5): the check-in is an EMAIL thing, so on the Text channel it is neither drawn nor submitted (the
  // save would refuse it), and while it is on the operator's message steps aside: the words are ours, fixed and
  // bilingual, because a paragraph typed here is exactly the gating the check-in exists to remove.
  const [checkin, setCheckin] = useState(stored.checkin);
  const openHref = openableHref(reviewUrl);

  // THE COUNTER COUNTS BODY PLUS LINK PLUS THE OPT-OUT SENTENCE, through the
  // ONE composer the pass uses and the SAME `withOptOut` the send path
  // applies, so what the operator approves is what is billed. The disclosure
  // is appended unconditionally by `sendAutomationSms` (send-sms.ts:82), in
  // English because the pass passes no `language`; counting the composed
  // text alone under-reported by 23 septets, and a long pasted review link
  // crossed into a second segment the counter never showed (decision B,
  // danlo, 2026-09-22). `withOptOut` is idempotent on a STOP instruction, so an
  // operator who wrote the sentence themselves is not counted twice. An
  // empty body previews the live default (empty-means-default, as the
  // column contract says), and an empty link previews the body alone.
  // `.trim()` because the pass defaults on `row.body.trim()` — a body of
  // nothing but spaces must preview the default too, or the counter shows
  // the link alone while the send carries the full default (review finding,
  // 2026-09-06).
  const previewBody = body.trim() || defaultReviewRequestBody(brandName);
  const preview = segmentsFor(withOptOut(composeReviewRequestSms(previewBody, reviewUrl)));

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
      success: m["automations.review.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="review-request-card">
      <CardHeader>
        <CardTitle>{m["automations.review.title"]}</CardTitle>
        <CardDescription>{m["automations.review.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="review-enabled" name="enabled" defaultChecked={stored.enabled} />
            <Label htmlFor="review-enabled">{m["automations.review.enabled"]}</Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review-channel">{m["automations.review.channel"]}</Label>
            <Select
              name="channel" defaultValue={stored.channel}
              onValueChange={(v) => setChannel(v === "sms" ? "sms" : "email")}
            >
              <SelectTrigger id="review-channel" className="w-full"><SelectValue /></SelectTrigger>
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
              placeholder={m["automations.review.urlPlaceholder"]}
            />
            <p className="text-xs text-muted-foreground">{m["automations.review.urlHint"]}</p>
            {openHref ? (
              // No server call: a plain anchor, so the agency sees exactly what customers will land on. noopener and
              // noreferrer, because the page it opens is Google's, not ours.
              <a
                href={openHref} target="_blank" rel="noopener noreferrer" data-testid="review-open-link"
                title={m["automations.review.openLinkHint"]}
                className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8"
              >
                {m["automations.review.openLink"]}
                <span className="sr-only">{m["automations.review.openLinkNewTab"]}</span>
              </a>
            ) : null}
          </div>

          {channel === "email" ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="review-checkin" name="checkin" checked={checkin}
                  onCheckedChange={(v) => setCheckin(v === true)}
                />
                <Label htmlFor="review-checkin">{m["automations.review.checkin.label"]}</Label>
              </div>
              <p className="text-xs text-muted-foreground">{m["automations.review.checkin.hint"]}</p>
            </div>
          ) : null}

          {/* Hidden, not unmounted, while the check-in is on: the text still submits with the form, so a save never
              wipes what the operator wrote, and turning the switch off brings it straight back. */}
          <ReviewMessageFields checkin={checkin} channel={channel}>
            <div className="space-y-1.5">
              <Label htmlFor="review-body">{m["automations.bodyEn.label"]}</Label>
              <Textarea
                id="review-body" name="body" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={body}
                className="min-h-11 md:min-h-8"
                onChange={(e) => setBody(e.target.value)}
                placeholder={defaultReviewRequestBody(brandName)}
              />
              <p className="text-xs text-muted-foreground">{m["automations.review.messageHint"]}</p>
              {channel === "sms" ? (
                <>
                  <p className="text-xs text-muted-foreground" data-testid="review-sms-count">
                    {m["compose.smsSegments"]
                      .replace("{chars}", String(preview.chars))
                      .replace("{segments}", String(preview.segments))}
                  </p>
                  {/* The count above includes the disclosure, and those 23
                      characters appear nowhere else on this page — the message
                      box shows the undisclosed default. Its own paragraph, so
                      the counter's testid still reads as one clean string;
                      inside the `sms` branch because an emailed review request
                      carries no opt-out sentence (referral-ask-card.tsx). */}
                  <p className="text-xs text-muted-foreground">{m["automations.optOutCounted"]}</p>
                </>
              ) : null}
            </div>
            <SpanishBodyField
              idPrefix="review"
              locale="en"
              stored={{ bodyEs: storedBodyEs, stale: spanishStale }}
              defaultEs={defaultReviewRequestBody(brandName, "es")}
              composeEs={(text) => (channel === "sms" ? withOptOut(composeReviewRequestSms(text, reviewUrl.trim()), "es") : text)}
              sms={channel === "sms"}
            />
          </ReviewMessageFields>

          <SubmitButton pending={pending}>{m["automations.review.save"]}</SubmitButton>
        </form>
        {/* Only for an account that has the check-in on (and by email): for any other the line would say "no check-ins
            yet" about a feature it never had. The STORED state, not the live switch: the counts describe what is saved. */}
        {stored.checkin && stored.channel === "email" ? counts : null}
      </CardContent>
    </Card>
  );
}
