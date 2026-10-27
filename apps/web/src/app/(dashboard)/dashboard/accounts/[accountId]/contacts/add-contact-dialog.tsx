"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { CreateContactResult } from "./actions";

function Submit({ pending, locale }: { pending: boolean; locale: Locale }) {
  return (
    <Button type="submit" disabled={pending}>
      {t(m, pending ? "common.saving" : "common.save", locale)}
    </Button>
  );
}

export function AddContactDialog({
  accountId,
  action,
}: {
  accountId: string;
  action: (formData: FormData) => Promise<CreateContactResult>;
}) {
  const [open, setOpen] = useState(false);
  // D-013: a dedupe match is neither a save nor a failure — the dialog
  // stays open with a plain sentence and a link to the record that already
  // exists, instead of closing silently as if a new contact had been made.
  const [existingContactId, setExistingContactId] = useState<string | null>(null);
  // F-085 follow-ups: the contacts list's LocaleProvider (requestLocale), the
  // same context its table and bulk bar read.
  const locale = useLocale();
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    let result: CreateContactResult;
    try {
      result = await action(formData);
    } catch {
      toast.error(t(m, "contacts.createFailed", locale));
      return;
    }
    if (result.kind === "invalid") {
      setExistingContactId(null);
      toast.error(result.error);
      return;
    }
    if (result.kind === "existing") {
      setExistingContactId(result.contactId);
      return;
    }
    setExistingContactId(null);
    setOpen(false);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setExistingContactId(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          {t(m, "contacts.add", locale)}
        </Button>
      </DialogTrigger>
      {/* Portaled to the body, outside the list's own lang wrapper, so it carries lang itself. */}
      <DialogContent lang={locale} closeLabel={t(m, "common.close", locale)}>
        <DialogHeader>
          <DialogTitle>{t(m, "contacts.add", locale)}</DialogTitle>
        </DialogHeader>
        <form
          // onSubmit, NOT the `action` prop: on the catch path the dialog
          // stays open and React's post-action reset cleared every field the
          // operator had just typed. See lib/forms/use-form-submit.ts. Nothing
          // to reset on success — the dialog closes.
          onSubmit={onSubmit}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">{t(m, "contacts.firstName", locale)}</Label>
              <Input id="firstName" name="firstName" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">{t(m, "contacts.lastName", locale)}</Label>
              <Input id="lastName" name="lastName" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t(m, "contacts.email", locale)}</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{t(m, "contacts.phone", locale)}</Label>
            <Input id="phone" name="phone" />
          </div>
          {existingContactId ? (
            <Notice tone="warn">
              {t(m, "contacts.add.existing", locale)}{" "}
              <Link
                href={`/dashboard/accounts/${accountId}/contacts/${existingContactId}`}
                className="underline underline-offset-2"
              >
                {t(m, "contacts.add.viewContact", locale)}
              </Link>
            </Notice>
          ) : null}
          <DialogFooter>
            <Submit pending={pending} locale={locale} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
