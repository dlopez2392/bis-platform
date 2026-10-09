"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { m } from "@/lib/messages";
import type { PublicLocale } from "@/lib/forms/public-strings";
import type { CancelNoticeChoice } from "./actions";
import { initialDraft, withLanguage, draftToChoice, type NoticeDraft } from "./cancel-notice-draft";
import { NOTICE_MESSAGE_MAX } from "./undo-window";

/**
 * F-048: Cancel on the Calendar page opens this. It is not an "Are you
 * sure?" (DESIGN.md rule 6): it composes the customer's notice, which the
 * owner can reword, put in Spanish, or not send. Its one primary button
 * cancels AT ONCE and the toast that follows carries Undo; the email goes
 * only once that Undo has closed (`cancel-notice.ts`).
 *
 * A customer with no email on file gets no notice, and the dialog says so in
 * words, naming what to do instead. English today; every string here has its
 * written-out Spanish twin in `messages.ts` (`.es`).
 */
export function CancelDialog({
  disabled, contactName, contactEmail, when, onConfirm,
}: {
  /** The row's Cancel button, while another write on it runs. */
  disabled: boolean;
  contactName: string;
  contactEmail: string | null;
  /** The appointment's time, already formatted in the account's zone. */
  when: string;
  onConfirm: (choice: CancelNoticeChoice) => void;
}) {
  const hasEmail = Boolean(contactEmail?.trim());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NoticeDraft>(() => initialDraft(hasEmail));
  const name = (key: keyof typeof m) => m[key].replace("{name}", contactName);

  function confirm() {
    setOpen(false);
    onConfirm(draftToChoice(draft, hasEmail));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A fresh draft each time it opens: last time's words were for last time.
        if (next) setDraft(initialDraft(hasEmail));
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          {m["calendar.bookings.cancel"]}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name("calendar.cancelDialog.title")}</DialogTitle>
          <DialogDescription className="tabular-nums">{when}</DialogDescription>
        </DialogHeader>

        {hasEmail ? (
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
                  <Label htmlFor="cancel-notice-language">{m["calendar.cancelDialog.language"]}</Label>
                  <Select
                    value={draft.locale}
                    onValueChange={(v) => setDraft((d) => withLanguage(d, v as PublicLocale))}
                  >
                    <SelectTrigger id="cancel-notice-language" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{m["calendar.cancelDialog.languageEnglish"]}</SelectItem>
                      <SelectItem value="es">{m["calendar.cancelDialog.languageSpanish"]}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cancel-notice-message">{m["calendar.cancelDialog.message"]}</Label>
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
                  <p className="text-xs text-muted-foreground">{m["calendar.cancelDialog.messageHint"]}</p>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{name("calendar.cancelDialog.noEmail")}</p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">{m["calendar.cancelDialog.keep"]}</Button>
          </DialogClose>
          <Button type="button" onClick={confirm}>{m["calendar.cancelDialog.confirm"]}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
