"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BoardOpportunity } from "./pipeline-board";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { useLocale } from "@/components/locale-provider";
import { useFormSubmit } from "@/lib/forms/use-form-submit";

function Submit({ pending, locale }: { pending: boolean; locale: Locale }) {
  return (
    <Button type="submit" disabled={pending}>
      {t(m, pending ? "common.saving" : "common.save", locale)}
    </Button>
  );
}

export function OpportunityDrawer({
  opportunity,
  onClose,
  action,
}: {
  opportunity: BoardOpportunity | null;
  onClose: () => void;
  action: (formData: FormData) => Promise<void>;
}) {
  // S-10 T3: the board's own LocaleProvider (requestLocale), the same context the board and its
  // add-opportunity dialog already read.
  const locale = useLocale();
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    try {
      await action(formData);
      onClose();
    } catch {
      toast.error(t(m, "pipeline.updateFailed", locale));
    }
  });
  return (
    <Sheet open={opportunity !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex flex-col gap-6" lang={locale}>
        <SheetHeader>
          <SheetTitle>{opportunity?.name ?? ""}</SheetTitle>
        </SheetHeader>
        {opportunity ? (
          <form
            // onSubmit, NOT the `action` prop: on the catch path the drawer
            // stays open, and React's post-action reset reverted the status
            // Select and the name Input to what the drawer opened with — the
            // operator's edit gone, the fields still looking edited. See
            // lib/forms/use-form-submit.ts. Nothing to reset on success: the
            // drawer closes.
            onSubmit={onSubmit}
            className="flex flex-1 flex-col gap-4"
          >
            <input type="hidden" name="oppId" value={opportunity.id} />
            <div className="space-y-2">
              <Label htmlFor="name">{t(m, "pipeline.name", locale)}</Label>
              <Input id="name" name="name" defaultValue={opportunity.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">{t(m, "pipeline.value", locale)}</Label>
              <Input
                id="value"
                name="value"
                type="number"
                step="0.01"
                defaultValue={opportunity.monetary_value}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">{t(m, "pipeline.status", locale)}</Label>
              <Select name="status" defaultValue={opportunity.status}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{t(m, "pipeline.status.open", locale)}</SelectItem>
                  <SelectItem value="won">{t(m, "pipeline.status.won", locale)}</SelectItem>
                  <SelectItem value="lost">{t(m, "pipeline.status.lost", locale)}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SheetFooter className="mt-auto">
              <Submit pending={pending} locale={locale} />
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
