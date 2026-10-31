"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MessageKey } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr } from "@/lib/record/copy";
import type { PublicLocale } from "@/lib/forms/public-strings";
import type { CancelNoticeChoice } from "./actions";
import { initialDraft, withLanguage, draftToChoice, type NoticeDraft } from "./cancel-notice-draft";
import { NOTICE_MESSAGE_MAX } from "./undo-window";

/**
 * F-048: the Calendar page's Cancel dialog. It opens ONLY when a customer
 * notice can go (`cancelStep`): it composes that notice, which the owner can
 * reword, put in Spanish, or not send. Anywhere no notice can go, Cancel
 * cancels at once instead, so this is never a bare "Are you sure?"
 * (DESIGN.md rule 6). Its one primary button cancels AT ONCE and the toast
 * that follows carries Undo; the email goes only once that Undo has closed
 * (`cancel-notice.ts`).
 *
 * The caller mounts it only while open, so each opening starts from a fresh
 * draft. Its words follow the drawer's language (`locale`, T11/T12 review:
 * a Spanish drawer opened an English dialog); the notice's own language is
 * the separate choice inside it (`defaultLocale`).
 */
export function CancelDialog({
  contactName, when, defaultLocale, locale = "en", pseudo = false, onOpenChange, onConfirm,
}: {
  contactName: string;
  /** The appointment's time, already formatted in the account's zone. */
  when: string;
  /** Task 17, C18: the customer's own language (`recipientLanguage`, read
   *  by the booking list from the row's contact, else the account), so the
   *  dialog opens already speaking to them in it. The owner still chooses. */
  defaultLocale: PublicLocale;
  /** The drawer's language, which the dialog's own words speak (English when absent). */
  locale?: Locale;
  /** The QA pseudo-locale (lib/record/copy.ts). */
  pseudo?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (choice: CancelNoticeChoice) => void;
}) {
  const [draft, setDraft] = useState<NoticeDraft>(() => initialDraft(defaultLocale));
  const tr = makeTr(locale, pseudo);
  const name = (key: MessageKey) => tr.text(key, { name: contactName });

  function confirm() {
    onOpenChange(false);
    onConfirm(draftToChoice(draft));
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid="cancel-dialog" lang={locale}>
        <DialogHeader>
          <DialogTitle>{name("calendar.cancelDialog.title")}</DialogTitle>
          <DialogDescription className="tabular-nums">{when}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="cancel-notice-send"
              checked={draft.send}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, send: v === true }))}
            />
            <Label htmlFor="cancel-notice-send">{name("calendar.cancelDialog.notify")}</Label>
          </div>

          {draft.send ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="cancel-notice-language">{tr.text("calendar.cancelDialog.language")}</Label>
                <Select
                  value={draft.locale}
                  onValueChange={(v) => setDraft((d) => withLanguage(d, v as PublicLocale))}
                >
                  <SelectTrigger id="cancel-notice-language" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">{tr.text("calendar.cancelDialog.languageEnglish")}</SelectItem>
                    <SelectItem value="es">{tr.text("calendar.cancelDialog.languageSpanish")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cancel-notice-message">{tr.text("calendar.cancelDialog.message")}</Label>
                <Textarea
                  id="cancel-notice-message"
                  // The customer reads this; `lang` lets a screen reader say it right.
                  lang={draft.locale}
                  rows={4}
                  maxLength={NOTICE_MESSAGE_MAX}
                  value={draft.message}
                  onChange={(e) => {
                    const message = e.target.value;
                    setDraft((d) => ({ ...d, message }));
                  }}
                />
                <p className="text-xs text-muted-foreground">{tr.text("calendar.cancelDialog.messageHint")}</p>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">{tr.text("calendar.cancelDialog.keep")}</Button>
          </DialogClose>
          <Button type="button" onClick={confirm}>{tr.text("calendar.cancelDialog.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
