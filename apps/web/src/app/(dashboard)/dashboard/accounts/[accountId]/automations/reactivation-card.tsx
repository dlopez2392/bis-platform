"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  REACTIVATION_MIN_MONTHS, REACTIVATION_MAX_MONTHS, REACTIVATION_DEFAULT_MONTHS,
  type AutomationRow,
} from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { defaultReactivationBody } from "@/lib/automations/reactivation-copy";
import type { ActionResult } from "./actions";

type StoredForm = { enabled: boolean; months: number; body: string };

/** Lenient on the raw jsonb, like the sibling cards: a stored value the pass
 *  refuses must still be SHOWN so the operator can fix it. The only thing a
 *  junk `months` cannot do is become the number in the box — the input needs
 *  something, and the platform default is the honest guess. */
function formDefaults(row: AutomationRow | null): StoredForm {
  const cfg = row?.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return {
    enabled: row?.enabled ?? false,
    months: typeof cfg.months === "number" && Number.isFinite(cfg.months)
      ? cfg.months : REACTIVATION_DEFAULT_MONTHS,
    body: row?.body ?? "",
  };
}

/**
 * Which of the two things the check-in cannot go without is missing — ONE
 * sentence either way, with the Settings page as a link where the catalogue
 * says `{settingsLink}`. Null when nothing is.
 *
 * TWO VOICES, keyed on the STORED `enabled` (review minor M3, 2026-09-22):
 * `missing*` for a recipe saved ON — something configured is broken and
 * check-ins that should be going are not — and `beforeOn*` for one that is
 * off or was never saved, where nothing is broken yet and the sentence only
 * says what turning it on needs.
 */
function missingKey(missing: { mailingAddress: boolean; replyTo: boolean }, storedOn: boolean) {
  if (missing.mailingAddress && missing.replyTo) {
    return storedOn ? "automations.reactivation.missingBoth" as const : "automations.reactivation.beforeOnBoth" as const;
  }
  if (missing.mailingAddress) {
    return storedOn
      ? "automations.reactivation.missingMailingAddress" as const
      : "automations.reactivation.beforeOnMailingAddress" as const;
  }
  if (missing.replyTo) {
    return storedOn ? "automations.reactivation.missingReplyTo" as const : "automations.reactivation.beforeOnReplyTo" as const;
  }
  return null;
}

/**
 * NO CHANNEL SELECT, and that is the product refusing rather than the card
 * forgetting: this recipe is EMAIL ONLY (spec decision 4) because there is no
 * per-contact SMS consent in this schema, and the due-row carries no phone
 * number for a pass to reach. Offering a choice the product refuses is worse
 * than stating the limit, so the description says "Email only" instead.
 *
 * NO SEGMENT COUNTER either, for the same reason: nothing here is ever
 * measured against a GSM-7 budget.
 */
export function ReactivationCard({
  automation, brandName, accountId, missing, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  /** For the Settings link in the missing-address/reply-to sentence. */
  accountId: string;
  /** `missingForReactivation` over the account's address and reply-to
   *  (page.tsx) — the same judgement the save refuses on and the pass skips
   *  on (decision A, 2026-09-22). `true` = missing. */
  missing: { mailingAddress: boolean; replyTo: boolean };
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = formDefaults(automation);
  // `stored.enabled` is the ROW as saved (`automation?.enabled ?? false`),
  // never the checkbox's unsaved state.
  const key = missingKey(missing, stored.enabled);
  const [missingLead = "", missingTail = ""] = key ? m[key].split("{settingsLink}") : [];
  // The agency edits branding on Settings (settings/page.tsx renders the
  // BrandingPanel) and this page is agency-only, so the link goes there
  // rather than to the client-voice Branding page. No anchor: the palette
  // registry has none for the branding panel.
  const settingsLink = (
    <Link href={`/dashboard/accounts/${accountId}/settings`} className="underline underline-offset-2">
      {m["nav.settings"]}
    </Link>
  );
  const [body, setBody] = useState(stored.body);

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.reactivation.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="reactivation-card">
      <CardHeader>
        <CardTitle>{m["automations.reactivation.title"]}</CardTitle>
        <CardDescription>{m["automations.reactivation.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* FIRST, above the switch: the save refuses to turn this on and
              nothing is sent until it is fixed, so the operator reads why
              before reaching for the checkbox. Saved ON, it is the amber
              Notice — a SENTENCE, so it keeps the foreground and lets the
              ground carry the hue (notice.tsx; alert-phone-card.tsx is the
              same shape). Off or never saved, nothing is broken yet, so it
              is a muted line like the hints below it; every account starts
              there. */}
          {key && stored.enabled ? (
            <Notice tone="warn" className="text-foreground" data-testid="reactivation-missing">
              {missingLead}{settingsLink}{missingTail}
            </Notice>
          ) : key ? (
            <p className="text-xs text-muted-foreground" data-testid="reactivation-missing">
              {missingLead}{settingsLink}{missingTail}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Checkbox id="reactivation-enabled" name="enabled" defaultChecked={stored.enabled} />
            <Label htmlFor="reactivation-enabled">{m["automations.reactivation.enabled"]}</Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reactivation-months">{m["automations.reactivation.months"]}</Label>
            <div className="flex items-center gap-2">
              {/* THE CONSTANTS, never the literals 6/18/9: the input and
                  `parseReactivationConfig` must not be able to disagree. What
                  `max` buys is narrow — the browser refuses to fire `submit`
                  at all when the value is out of range, so the server's
                  `monthsInvalid` message is unreachable from a normal
                  keyboard, which is why the parser's refusal is proved in
                  actions.test.ts and never in Playwright. */}
              <Input
                id="reactivation-months" name="months" type="number" className="w-24"
                min={REACTIVATION_MIN_MONTHS} max={REACTIVATION_MAX_MONTHS} step={1}
                defaultValue={stored.months}
              />
              {/* text-xs, matching the hint directly beneath it and every
                  other secondary string on all nine cards. It was 13px, a
                  size nothing else on this page uses (design review M3). */}
              <span className="text-xs text-muted-foreground">
                {m["automations.reactivation.monthsUnit"]}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{m["automations.reactivation.monthsHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reactivation-body">{m["automations.reactivation.message"]}</Label>
            <Textarea
              id="reactivation-body" name="body" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultReactivationBody(brandName)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.reactivation.messageHint"]}</p>
          </div>

          {/* ALWAYS RENDERED: a cap is context, and DESIGN.md rule 1 says a
              number never ships alone. The prose restates the limit in words
              because a static catalogue cannot interpolate a constant;
              `reactivation-copy.test.ts` is what keeps the two in step. */}
          <p className="text-xs text-muted-foreground" data-testid="reactivation-limit-note">
            {m["automations.reactivation.limitNote"]}
          </p>

          <SubmitButton pending={pending}>{m["automations.reactivation.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
