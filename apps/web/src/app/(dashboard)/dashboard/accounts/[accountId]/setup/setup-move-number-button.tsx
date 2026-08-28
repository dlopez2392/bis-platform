"use client";

import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import type { SetupMoveNumberAction } from "./setup-panel";

/**
 * Takes a number off another client and puts it on this one.
 *
 * The destination account is bound server-side into the action — only the
 * phone number id travels from here, so a tampered submission can pick a
 * different number but never a different account to give it to. The action
 * re-checks agency access before the write regardless (voice/actions.ts).
 *
 * Toasted rather than inline, unlike the go-live button on the same page: a
 * failure here means "that particular number didn't move", and the row it
 * belongs to is still on screen after `router.refresh()` re-reads the list.
 */
export function SetupMoveNumberButton({
  action, phoneNumberId, e164,
}: {
  action: SetupMoveNumberAction;
  phoneNumberId: string;
  /** For the accessible name only — the action moves by id. */
  e164: string;
}) {
  const router = useRouter();
  return (
    <form
      action={async () => {
        const result = await action(phoneNumberId);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        // The number step flips to done and this whole list disappears —
        // both are re-derived by the refresh, nothing is patched locally.
        router.refresh();
      }}
    >
      <PendingButton e164={e164} />
    </form>
  );
}

function PendingButton({ e164 }: { e164: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={m["setup.number.moveHereLabel"].replace("{e164}", e164)}
    >
      {pending ? null : <ArrowLeftRight aria-hidden />}
      {pending ? m["setup.number.moving"] : m["setup.number.moveHere"]}
    </Button>
  );
}
