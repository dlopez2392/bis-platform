"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import type { AiCardView } from "@/lib/ai/settings-view";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { AiGlobalResult, AiPrior, AiSaveResult } from "./ai-actions";
import { aiCardHandlers } from "./ai-card-handlers";

/**
 * The agency's AI card (item 8a-1, spec 3.6). Its own view (rule 8): one primary Save for this account's switch
 * and budget; the global switch is an outline button whose OFF direction confirms by typing the word (rule 6),
 * and whose ON direction is immediate with Undo. Rendered only on Settings, which is agency-only; every action
 * re-checks that itself. In the reader's own language, with `lang` on the card (the page around it is English).
 */
const control = "min-h-11 md:min-h-8";

export function confirmMatches(typed: string, word: string): boolean {
  return typed.trim().toUpperCase() === word;
}

export function AiCard({ view, locale, save, undo, setGlobal }: {
  view: AiCardView; locale: Locale;
  save: (input: { enabled: boolean; budget: string }) => Promise<AiSaveResult>;
  undo: (prior: AiPrior, wrote: AiPrior) => Promise<AiSaveResult>;
  setGlobal: (input: { enabled: boolean; confirm?: string; expected?: boolean }) => Promise<AiGlobalResult>;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const router = useRouter();
  const [enabled, setEnabled] = useState(view.accountEnabled);
  const [budget, setBudget] = useState(view.budgetDollars);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const h = aiCardHandlers({ locale, toast, refresh: () => router.refresh(), save, undo, setGlobal });
  const word = tt("aiSettings.global.confirmWord");
  const close = () => { setConfirming(false); setTyped(""); };

  return (
    <Card id="ai" data-ai-card lang={locale} className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{tt("aiSettings.title")}</CardTitle>
        <CardDescription>{tt("aiSettings.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.spendLine
          ? <p data-ai-spend className="text-sm tabular-nums">{view.spendLine}</p>
          : <p data-ai-empty className="text-sm text-muted-foreground">{tt("aiSettings.empty")}</p>}
        {view.reachedLine ? <Notice tone="warn" data-ai-reached className="text-foreground">{view.reachedLine}</Notice> : null}
        {view.skippedLine ? <p data-ai-skipped className="text-xs text-muted-foreground tabular-nums">{view.skippedLine}</p> : null}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); setBusy(true); void h.save({ enabled, budget }).finally(() => setBusy(false)); }}
        >
          <label className={`flex items-center gap-2 text-sm ${control}`}>
            <Checkbox data-ai-account checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <span>{tt("aiSettings.account.label")}</span>
          </label>
          <p className="text-xs text-muted-foreground">{tt("aiSettings.account.help")}</p>
          <Label htmlFor="ai-budget">{tt("aiSettings.budget.label")}</Label>
          <Input id="ai-budget" data-ai-budget inputMode="numeric" autoComplete="off" value={budget}
            onChange={(e) => setBudget(e.target.value)} className={`max-w-40 tabular-nums ${control}`} />
          <p className="text-xs text-muted-foreground">{tt("aiSettings.budget.help")}</p>
          <div>
            <Button type="submit" data-ai-save disabled={busy} className={control}>{tt("aiSettings.save")}</Button>
          </div>
        </form>
        <div data-ai-global className="flex flex-col gap-2 border-t border-[var(--line)] pt-4">
          <p className="text-sm font-medium">{tt("aiSettings.global.label")}</p>
          <p className="text-xs text-muted-foreground">{tt(view.globalEnabled ? "aiSettings.global.onHelp" : "aiSettings.global.offHelp")}</p>
          <div>
            {view.globalEnabled
              ? <Button type="button" variant="outline" data-ai-global-off className={control} onClick={() => setConfirming(true)}>{tt("aiSettings.global.turnOff")}</Button>
              : <Button type="button" variant="outline" data-ai-global-on className={control} onClick={() => { void h.setGlobal(true); }}>{tt("aiSettings.global.turnOn")}</Button>}
          </div>
        </div>
        <Dialog open={confirming} onOpenChange={(open) => { if (!open) close(); }}>
          <DialogContent data-ai-confirm lang={locale}>
            <DialogHeader><DialogTitle>{tt("aiSettings.global.confirmTitle")}</DialogTitle></DialogHeader>
            <AiGlobalConfirmForm word={word} typed={typed} busy={busy} locale={locale} onTyped={setTyped} onCancel={close}
              onConfirm={() => { setBusy(true); void h.setGlobal(false, typed).then((done) => { if (done) close(); }).finally(() => setBusy(false)); }} />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** Presentational, so the test reads it without a portal (document-purge-dialog.tsx's shape). The dialog's one primary is its destructive confirm. */
export function AiGlobalConfirmForm({ word, typed, busy, locale, onTyped, onCancel, onConfirm }: {
  word: string; typed: string; busy: boolean; locale: Locale; onTyped: (v: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{tt("aiSettings.global.confirmBody", { word })}</p>
      <label className="block space-y-1 text-sm">
        <span>{tt("aiSettings.global.confirmLabel")}</span>
        <Input data-ai-confirm-input value={typed} autoComplete="off" spellCheck={false} onChange={(e) => onTyped(e.target.value)} className={control} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className={control} onClick={onCancel}>{tt("aiSettings.global.cancel")}</Button>
        <Button type="button" variant="destructive" data-ai-confirm-off className={control} disabled={!confirmMatches(typed, word) || busy} onClick={onConfirm}>
          {tt("aiSettings.global.turnOff")}
        </Button>
      </div>
    </div>
  );
}

/** Rule 7: shaped like the card, never a spinner. Keeps the palette's anchor. */
export function AiCardSkeleton() {
  return (
    <Card id="ai" className="scroll-mt-24" aria-busy="true">
      <CardHeader><Skeleton className="h-5 w-16" /><Skeleton className="h-4 w-64 max-w-full" /></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-24" />
      </CardContent>
    </Card>
  );
}

export function AiCardError({ locale }: { locale: Locale }) {
  return (
    <Card id="ai" data-ai-error lang={locale} className="scroll-mt-24">
      <CardHeader><CardTitle>{t(m, "aiSettings.title", locale)}</CardTitle></CardHeader>
      <CardContent><Notice tone="warn" className="text-foreground">{t(m, "aiSettings.loadError", locale)}</Notice></CardContent>
    </Card>
  );
}
