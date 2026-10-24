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
  accountId, bookingId, locale, pseudo,
}: {
  accountId: string; bookingId: string; locale: Locale; pseudo: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const tr = makeTr(locale, pseudo);

  // Once kept, the row itself shows "Kept" as text (affected-appointment-row.tsx, fix round C8) and never
  // mounts this button, so it has no kept branch of its own.

  function onKeep() {
    startTransition(async () => {
      await runKeepWithUndo(
        (kept) => keepAppointmentAction(accountId, bookingId, kept, locale),
        toast,
        {
          keptToast: tr.text("business.card.keptToast"), undo: tr.text("common.undo"),
          failed: tr.text("business.card.keepFailed"),
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
