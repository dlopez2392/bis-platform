"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";
import { runGuarded } from "@/lib/ui/guarded-run";
import { runTextsAction } from "@/lib/consent/texts-row";
import type { TextsActionResult } from "@/lib/consent/staff-actions";

/**
 * A hold To-do's two buttons (spec §6): "Confirm stop" and "Not a stop",
 * ghost, each at once with an Undo toast (rule 6). Props are the To-do
 * screen's server actions, bound to the account by work-list.tsx (this
 * folder's own precedent for a client list under a server page).
 */
export function ConsentHoldActions({ taskId, contactId, confirm, release, undo }: {
  taskId: string;
  contactId: string | null;
  confirm: (taskId: string) => Promise<TextsActionResult>;
  release: (taskId: string) => Promise<TextsActionResult>;
  undo: (contactId: string, eventId: string, reopenTaskIds: string[]) => Promise<TextsActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  // F-085 follow-up (Task B): the To do page's LocaleProvider, same context
  // AssigneeField and WorkRowActions already read.
  const locale = useLocale();
  const run = (work: () => Promise<void>): boolean => runGuarded(busy, startTransition, work);
  const act = (call: () => Promise<TextsActionResult>, success: string) => {
    if (pending || busy.current || !contactId) return;
    run(async () => {
      await runTextsAction(call, () => router.refresh(), toast, {
        success, run, onChanged: () => router.refresh(),
        undo: (u) => u.kind === "decision" ? undo(contactId, u.eventId, u.reopenTaskIds) : Promise.resolve({ ok: false, error: t(m, "todo.consent.failed", locale) }),
      });
    });
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" disabled={pending || !contactId} onClick={() => act(() => confirm(taskId), t(m, "contact.texts.confirmedToast", locale))}>
        {t(m, "contact.texts.confirmStop", locale)}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending || !contactId} onClick={() => act(() => release(taskId), t(m, "contact.texts.releasedToast", locale))}>
        {t(m, "contact.texts.notAStop", locale)}
      </Button>
    </div>
  );
}
