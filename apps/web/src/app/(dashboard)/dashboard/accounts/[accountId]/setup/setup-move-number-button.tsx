"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { ArrowLeftRight, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { PhoneNumberStatus } from "@bis/db";
import { Button } from "@/components/ui/button";
import { requiresMoveConfirm } from "@/lib/setup/setup-view";
import { m } from "@/lib/messages";
import type { SetupMoveNumberAction } from "./setup-panel";

/**
 * Takes a number off another client and puts it on this one.
 *
 * The destination account is bound server-side into the action — only the
 * phone number id travels from here, so a tampered submission can pick a
 * different number but never a different account to give it to. The action
 * re-checks agency access, and now the destination itself, before the write
 * regardless (voice/actions.ts).
 *
 * `status` gates a CONFIRM step, not the request itself. `testing`/`live`
 * numbers are answering some other client's real callers right now — the
 * incoming route accepts either status, and a reassign resets the row to
 * `provisioned` (both: `requiresMoveConfirm`, lib/setup/setup-view.ts, which
 * carries the actual decision so it has a test — this component only renders
 * around it). Taking one of those is putting another client's line out of
 * service with one click, which is exactly the thing a setup wizard button
 * must not be able to do by accident.
 *
 * No `window.confirm`: blocking dialogs are banned in this codebase's
 * browser tooling. The confirm is inline instead — the same button flips
 * into its destructive-styled "yes" copy plus a separate Cancel, matching
 * every other write on this page being a `<form action={…}>` island rather
 * than a modal. `provisioned`/`released` numbers skip straight to the
 * original one-click form.
 *
 * Toasted rather than inline, unlike the go-live button on the same page: a
 * failure here means "that particular number didn't move", and the row it
 * belongs to is still on screen after `router.refresh()` re-reads the list.
 */
export function SetupMoveNumberButton({
  action, phoneNumberId, e164, status, accountName,
}: {
  action: SetupMoveNumberAction;
  phoneNumberId: string;
  /** For the accessible name and confirm copy only — the action moves by id. */
  e164: string;
  status: PhoneNumberStatus;
  /** Whose line goes down. Null renders the same "we couldn't name it"
   *  fallback the row's own caption uses. */
  accountName: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const needsConfirm = requiresMoveConfirm(status);

  const submit = async () => {
    const result = await action(phoneNumberId);
    if (!result.ok) {
      toast.error(result.error);
      setConfirming(false);
      return;
    }
    // The number step flips to done and this whole list disappears —
    // both are re-derived by the refresh, nothing is patched locally.
    router.refresh();
  };

  if (needsConfirm && !confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={m["setup.number.moveHereLabel"].replace("{e164}", e164)}
      >
        <ArrowLeftRight aria-hidden />
        {m["setup.number.moveHere"]}
      </Button>
    );
  }

  if (needsConfirm) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p
          role="alert"
          className="w-full basis-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
        >
          {m["setup.number.moveConfirmWarning"].replace(
            "{account}",
            accountName ?? m["setup.number.unknownAccount"],
          )}
        </p>
        <form action={submit}>
          <ConfirmMoveButton e164={e164} />
        </form>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          {m["common.cancel"]}
        </Button>
      </div>
    );
  }

  return (
    <form action={submit}>
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

/** The confirm step's own button, reached only after the first click above.
 *  Destructive-styled and named for the consequence — "take it out of
 *  service", not merely "move" — because by the time this renders the
 *  operator has already been told whose line it is. */
function ConfirmMoveButton({ e164 }: { e164: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? null : <TriangleAlert aria-hidden />}
      {pending ? m["setup.number.moving"] : m["setup.number.moveConfirm"].replace("{e164}", e164)}
    </Button>
  );
}
