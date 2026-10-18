"use client";

import { useEffect, useRef, useState } from "react";
import { REQUIRABLE_DOCUMENT_CATEGORIES, type RequirableCategory } from "@bis/db/document-rules";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SubmitButton } from "../../submit-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { requiredFormEntries } from "../settings/required-documents-card";
import { requiredListHandlers } from "./required-documents-handlers";
import type { RequiredUndoAnswer } from "./required-documents-actions";

/**
 * The Owner's Required documents card (S-07 3a, spec 3.3): at the top of the Documents page for an
 * Owner and the agency. A collapsed summary line that opens into 2c's eight-category picker. Its own
 * view (rule 8): one primary Save, its own toast and Undo. A failed read draws one sentence and no
 * picker (rule 5).
 */
export function requiredSummaryText(list: readonly RequirableCategory[], locale: Locale): string {
  if (list.length === 0) return t(m, "documents.required.summaryOff", locale);
  const names = list.map((c) => t(m, `documents.category.${c}` as MessageKey, locale)).join(", ");
  return t(m, "documents.required.summary", locale, { list: names, count: list.length });
}

/** Review M9: ⌘K's nav:required-documents lands on #required-documents; the collapsed card opens itself for it. */
export const REQUIRED_DOCUMENTS_HASH = "#required-documents";
export const shouldOpenForHash = (hash: string): boolean => hash === REQUIRED_DOCUMENTS_HASH;

export function RequiredDocumentsSummary({ required, locale, save, undo }: {
  required: RequirableCategory[] | null;
  locale: Locale;
  save: (formData: FormData) => Promise<{ ok: true; list: string[] } | { ok: false; error: string }>;
  undo: (expected: string[], previous: string[]) => Promise<RequiredUndoAnswer>;
}) {
  const [saved, setSaved] = useState<RequirableCategory[]>(required ?? []);
  const [picked, setPicked] = useState<Set<RequirableCategory>>(() => new Set(required ?? []));
  const handlers = requiredListHandlers({
    locale, save, undo,
    onChange: (list) => { setSaved(list); setPicked(new Set(list)); },
  });
  const { pending, onSubmit } = useFormSubmit((formData) => handlers.submit(formData, saved));
  const tt = (key: MessageKey) => t(m, key, locale);
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    // A DOM property, never state (react-hooks/set-state-in-effect): open on arrival and on a later hash change.
    const onHash = () => { if (details.current && shouldOpenForHash(window.location.hash)) details.current.open = true; };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (required === null) {
    return (
      <Card id="required-documents" data-required-documents className="scroll-mt-24">
        <CardContent>
          <p role="alert" className="text-sm text-muted-foreground">{tt("documents.required.loadFailed")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="required-documents" data-required-documents className="scroll-mt-24">
      <CardContent>
        <details ref={details}>
          <summary className="min-h-11 cursor-pointer rounded-[var(--radius-ctl)] py-2 text-sm font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
            {requiredSummaryText(saved, locale)}
          </summary>
          <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{tt("settings.requiredDocuments.body")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {REQUIRABLE_DOCUMENT_CATEGORIES.map((c) => (
                <label key={c} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
                  <Checkbox
                    checked={picked.has(c)}
                    onCheckedChange={(v) => setPicked((prev) => {
                      const next = new Set(prev);
                      if (v === true) next.add(c);
                      else next.delete(c);
                      return next;
                    })}
                  />
                  {tt(`documents.category.${c}` as MessageKey)}
                </label>
              ))}
            </div>
            {requiredFormEntries(picked).map(([name, value]) => (
              <input key={value} type="hidden" name={name} value={value} />
            ))}
            {picked.size === 0 ? (
              <p className="text-xs text-muted-foreground">{tt("settings.requiredDocuments.off")}</p>
            ) : null}
            <SubmitButton pending={pending}>{tt("common.save")}</SubmitButton>
          </form>
        </details>
      </CardContent>
    </Card>
  );
}
