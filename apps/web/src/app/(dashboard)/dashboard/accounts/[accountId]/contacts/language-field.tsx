"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language-options";
import type { LanguageView } from "@/lib/contacts/language";
import { setContactLanguageAction, restoreContactLanguageAction, keepContactLanguageHintAction } from "./actions";
import { chooseLanguage, keepLanguage, type LanguageFieldDeps } from "./language-field-handlers";

/**
 * S-09 §8: the customer's language, under Phone, on the record page and in the drawer. The value is a
 * Select (saves on change, Undo toast; no "Not set" option: a person can set a language, not un-know
 * one); the phrase says where it came from; the hint offers Switch / Keep as ghosts (rule 8: the one
 * primary is Call). Every string arrives built by `languageView` on the server, except the controls'.
 */
export function LanguageField({ accountId, contactId, view, onChanged }: {
  accountId: string; contactId: string; view: LanguageView; onChanged: () => void;
}) {
  const locale = useLocale();
  const label = t(m, "contact.language.label", locale);
  const deps: LanguageFieldDeps = {
    set: (language) => setContactLanguageAction(accountId, contactId, language),
    restore: (prior, written) => restoreContactLanguageAction(accountId, contactId, prior, written),
    keep: () => keepContactLanguageHintAction(accountId, contactId),
    toast, onChanged, locale,
  };
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2" data-language-row="" data-language={view.value ?? ""}>
      <dt className="text-muted-foreground pt-2 text-xs">{label}</dt>
      <dd className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1">
          <Select value={view.value ?? undefined} onValueChange={(v) => { if (v === "en" || v === "es") void chooseLanguage(deps, v); }}>
            <SelectTrigger size="sm" aria-label={label}
              className="min-h-11 md:min-h-8 border-transparent bg-transparent px-2 hover:bg-[var(--surface-3)]">
              {view.valueLabel ? <span lang={view.value!}>{view.valueLabel}</span>
                : <SelectValue placeholder={t(m, "contact.language.choose", locale)} />}
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}><span lang={o.value}>{o.label}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          {view.value ? <span aria-hidden className="text-muted-foreground text-xs">·</span> : null}
          <span className="text-muted-foreground break-words text-xs" data-language-phrase="">{view.phrase}</span>
        </div>
        {view.hint ? (
          <div data-language-hint="" className="mt-1 flex flex-wrap items-center gap-2 px-2">
            <p className="text-muted-foreground text-xs">{view.hint.text}</p>
            <Button type="button" variant="ghost" size="xs" className="min-h-11 md:min-h-8"
              onClick={() => void chooseLanguage(deps, view.hint!.language)}>{t(m, "contact.language.switch", locale)}</Button>
            <Button type="button" variant="ghost" size="xs" className="min-h-11 md:min-h-8"
              onClick={() => void keepLanguage(deps)}>{t(m, "contact.language.keep", locale)}</Button>
          </div>
        ) : null}
      </dd>
    </div>
  );
}
