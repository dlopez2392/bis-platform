"use client";

/**
 * S-47c (plan Task 8; spec 5.3): the two flags under the Facts box — hours
 * written in Facts (Business hours above now owns them) and amounts written
 * in Facts or Services (the price list above now owns them). Recomputed live
 * from the textarea's own value on every keystroke (`factsWarnings`, pure);
 * never blocks Save — this renders nothing the profile form's own `onSubmit`
 * reads. `hasHours`/`hasPriceList` are the STORED state, passed down as
 * props: the warning is about what {persona} already knows from elsewhere,
 * not about what this unsaved edit will become.
 */
import { useMemo } from "react";
import { Notice } from "@/components/ui/notice";
import { makeTr } from "@/lib/record/copy";
import { factsWarnings } from "@/lib/voice/knowledge/facts-warnings";

export function FactsFlags({
  facts, servicesText, hasHours, hasPriceList, locale, pseudo, persona,
}: {
  /** The Facts textarea's live, unsaved value. */
  facts: string;
  /** The Services (free text) textarea's live, unsaved value. */
  servicesText: string;
  /** Whether the account already has structured Business hours (`profile.business_hours`). */
  hasHours: boolean;
  /** Whether the account already has a Services & prices list. */
  hasPriceList: boolean;
  locale: "en" | "es";
  pseudo: boolean;
  persona: string;
}) {
  const tr = useMemo(() => makeTr(locale, pseudo), [locale, pseudo]);
  const { hours, amounts } = factsWarnings(facts, servicesText, { hasHours, hasPriceList });
  if (!hours && amounts.length === 0) return null;
  const amountsText = amounts.map((a) => `"${a.text}"`).join(", ");
  return (
    <div className="space-y-2" lang={locale}>
      {hours === "notice" ? <Notice tone="warn">{tr.text("voice.facts.hoursNotice", { persona })}</Notice> : null}
      {hours === "hint" ? <p className="text-xs text-muted-foreground">{tr.text("voice.facts.hoursHint", { persona })}</p> : null}
      {amounts.length > 0 ? (
        <Notice tone="warn">{tr.text("voice.facts.amountsNotice", { persona, amounts: amountsText })}</Notice>
      ) : null}
    </div>
  );
}
