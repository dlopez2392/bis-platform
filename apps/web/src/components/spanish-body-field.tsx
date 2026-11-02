"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SmsPreview } from "@/components/sms-preview";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { segmentsFor, accentCost } from "@/lib/sms/segments";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";

export type SpanishBodyFieldProps = {
  /** Unique per card, e.g. "review". Builds the element ids. */
  idPrefix: string;
  /** The stored row (null = never saved): drives the opening text and the stale line. */
  stored: { bodyEs: string | null; stale: boolean };
  /** Our written Spanish, rendered with the brand name ("" for the confirmation card, plan deviation 4). */
  defaultEs: string;
  /** Turns the box's text into the string a Spanish customer receives (lead + body + link + opt-out). */
  composeEs: (text: string) => string;
  /** SMS cards count parts and show the accent line; email cards do not. */
  sms: boolean;
  /** S-10 T9b: the reader's own language — the agency's own cards (Automations,
   *  Voice) bind "en"; the one client-reachable caller (Calendar settings'
   *  follow-up section, shown to the Owner too) binds its own resolved locale. */
  locale?: Locale;
};

/**
 * S-09 PR 2, spec §12.2: the Spanish box beside an editable English message. Part of the card's ONE
 * form (rule 8): nothing here saves on its own. NULL stored = our Spanish (shown pre-filled); '' =
 * emptied (Spanish customers get the English); else theirs. The stale line reads the STORED row
 * (plan deviation 5); the emptied line reads the box (what Save will store).
 */
export function SpanishBodyField({ idPrefix, stored, defaultEs, composeEs, sms, locale = "en" }: SpanishBodyFieldProps) {
  const [text, setText] = useState(stored.bodyEs ?? defaultEs);
  const [useOurs, setUseOurs] = useState(false);
  const id = `${idPrefix}-body-es`;
  const blank = text.trim() === "";
  const emptied = blank && (defaultEs.trim() !== "" || (stored.bodyEs === "" && !useOurs));
  const sent = emptied ? "" : composeEs(text.trim());
  const parts = sent ? segmentsFor(sent) : null;
  const cost = sms ? accentCost(sent) : null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(m, "automations.bodyEs.label", locale)}</Label>
      <Textarea
        id={id} name="body_es" lang="es" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={text}
        className="min-h-11 md:min-h-8"
        onChange={(e) => { setText(e.target.value); setUseOurs(false); }}
      />
      <input type="hidden" name="body_es_use_ours" value={useOurs ? "1" : ""} />
      <p className="text-xs text-muted-foreground">{t(m, "automations.bodyEs.hint", locale)}</p>
      {stored.stale && !emptied ? (
        <div className="space-y-1.5">
          <p className="flex items-center gap-2 text-xs">
            <span data-stale-dot aria-hidden="true" className="inline-block size-2 rounded-full bg-[var(--accent)]" />
            {t(m, "automations.bodyEs.stale", locale)}
          </p>
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-matches`} name="body_es_still_matches" />
            <Label htmlFor={`${id}-matches`}>{t(m, "automations.bodyEs.stillMatches", locale)}</Label>
          </div>
        </div>
      ) : null}
      {emptied ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{t(m, "automations.bodyEs.emptied", locale)}</span>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
            onClick={() => { setText(defaultEs); setUseOurs(true); }}>
            {t(m, "automations.bodyEs.useOurs", locale)}
          </Button>
        </div>
      ) : null}
      {cost && cost.parts > cost.foldedParts ? (
        <p className="text-xs text-muted-foreground">
          {t(m, "automations.bodyEs.accentCost", locale, { n: cost.parts, m: cost.foldedParts })}
        </p>
      ) : null}
      {sms ? (
        <div className="space-y-1.5" lang="es">
          <SmsPreview id={`${id}-preview`} label={t(m, "automations.previewEs", locale)} text={sent} testId={`${idPrefix}-preview-es`} />
          {parts ? (
            <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-count-es`}>
              {t(m, "compose.smsSegments", locale, { chars: parts.chars, segments: parts.segments })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
