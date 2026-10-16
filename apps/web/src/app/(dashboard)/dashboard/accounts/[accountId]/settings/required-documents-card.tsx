"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { REQUIRABLE_DOCUMENT_CATEGORIES, type RequirableCategory } from "@bis/db/document-rules";

/**
 * Agency-only (D6, 2026-10-16): rendered from the Settings page, which is
 * gated by requireAgencyOnlyAccountAccess. On WeeklyReportCard's pattern —
 * a client component with its own onSubmit (not the `action` prop), for the
 * same reason: React resets an action-prop form even when the action
 * resolved to {ok:false}, which would silently revert the ticks to the last
 * SAVED list while they still looked like the operator's own edit.
 *
 * The eight rows post hidden inputs built from `picked` rather than relying
 * on Radix's own Checkbox form participation, so the form posts exactly
 * what is drawn on screen (D8: eight categories, no "Other").
 */
export function requiredFormEntries(picked: ReadonlySet<RequirableCategory>): [string, string][] {
  return REQUIRABLE_DOCUMENT_CATEGORIES.filter((c) => picked.has(c)).map((c) => ["category", c]);
}

export function RequiredDocumentsCard({
  required, action,
}: {
  required: readonly RequirableCategory[];
  action: (formData: FormData) => Promise<{ ok: true; list: string[] } | { ok: false; error: string }>;
}) {
  const [picked, setPicked] = useState<Set<RequirableCategory>>(() => new Set(required));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    const success = picked.size === 0 ? m["settings.requiredDocuments.savedOff"] : m["settings.requiredDocuments.saved"];
    await notifyActionResult(() => action(formData), toast, {
      success,
      crashed: m["common.actionCrashed"],
    });
  });

  const toggle = (category: RequirableCategory, checked: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(category);
      else next.delete(category);
      return next;
    });
  };

  return (
    <Card id="required-documents" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["settings.requiredDocuments.title"]}</CardTitle>
        <CardDescription>{m["settings.requiredDocuments.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {REQUIRABLE_DOCUMENT_CATEGORIES.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
                <Checkbox checked={picked.has(c)} onCheckedChange={(v) => toggle(c, v === true)} />
                {m[`documents.category.${c}`]}
              </label>
            ))}
          </div>
          {requiredFormEntries(picked).map(([name, value]) => (
            <input key={value} type="hidden" name={name} value={value} />
          ))}
          {picked.size === 0 && (
            <p className="text-xs text-muted-foreground">{m["settings.requiredDocuments.off"]}</p>
          )}
          <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
