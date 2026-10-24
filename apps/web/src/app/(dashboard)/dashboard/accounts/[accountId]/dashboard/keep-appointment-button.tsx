"use client";

// S-47d Task 11 (spec §5.6.2): "Keep" on one appointment the business-status card lists as affected —
// DESIGN.md rule 6 (reversible, runs at once, Undo toast). The server write (`keepAppointmentAction`,
// Task 8) already runs on serviceDb() behind `proveBooking`; this file is the button and its toast only.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { keepAppointmentAction } from "../calendar/actions";
import { runKeepWithUndo } from "./keep-with-undo";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

export function KeepAppointmentButton({
  accountId, bookingId, kept, locale, pseudo,
}: {
  accountId: string; bookingId: string; kept: boolean; locale: Locale; pseudo: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const tr = makeTr(locale, pseudo);

  // Once kept, the row shows the fact rather than a button that would just repeat the same write
  // (spec: "A kept row shows business.card.kept in place of the button").
  if (kept) return <span className="text-sm text-muted-foreground">{tr.text("business.card.kept")}</span>;

  function onKeep() {
    startTransition(async () => {
      await runKeepWithUndo(
        (kept) => keepAppointmentAction(accountId, bookingId, kept, locale),
        toast,
        {
          keptToast: tr.text("business.card.keptToast"), undo: tr.text("common.undo"),
          failed: tr.text("business.toast.failed"),
        },
        () => router.refresh(),
      );
    });
  }

  return (
    <Button
      type="button" variant="ghost" size="sm" disabled={pending} onClick={onKeep}
      className="min-h-11 rounded-[var(--radius-ctl)] focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8"
    >
      {tr.text("business.card.keep")}
    </Button>
  );
}
