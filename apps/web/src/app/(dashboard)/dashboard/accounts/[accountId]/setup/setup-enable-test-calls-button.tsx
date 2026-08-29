"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import type { SetNumberStatusAction } from "./setup-panel";

/**
 * Flips the assigned number from `provisioned` to `testing` — the fix for
 * the wizard's own exit-gate finding: an operator who finished every other
 * step still had a number sitting `provisioned`, answering nobody, with
 * nothing on this page saying so or offering to fix it.
 *
 * Renders only when `canEnableTestCalls` (setup-view.ts) says the assigned
 * number's status is `provisioned` — the panel is what decides that, this
 * component just calls the action and reacts to its Result. `status` always
 * travels as the literal `"testing"`: this button has exactly one thing it
 * does, unlike `setNumberStatusAction` itself, which also drives the
 * go-live write (setup/actions.ts) with `"live"`.
 *
 * `testing` answers real calls the moment the write lands, REGARDLESS of the
 * receptionist toggle (`callAnswerable`, lib/voice/accept-gate.ts — Task 8),
 * so unlike go-live there is no second prerequisite this button is waiting
 * on. Inline error, not a toast, matching SetupGoLiveButton: this is the one
 * action that unblocks the whole test-call card, so a failure needs to stay
 * on screen next to the button rather than flash past in a toast.
 */
export function SetupEnableTestCallsButton({
  action, phoneNumberId,
}: {
  action: SetNumberStatusAction;
  phoneNumberId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <form
        action={async () => {
          setError(null);
          const result = await action(phoneNumberId, "testing");
          if (!result.ok) {
            setError(result.error);
            return;
          }
          // The test-call card re-derives its status and note from the
          // refreshed row — nothing here is patched locally.
          router.refresh();
        }}
      >
        <PendingButton />
      </form>

      {/* Hue in the border and the fill, never in the text — same rule the
          panel's state chips and SetupGoLiveButton's own error follow. */}
      {error !== null ? (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PendingButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? null : <PhoneCall aria-hidden className="size-3.5" />}
      {pending ? m["setup.testCall.enabling"] : m["setup.testCall.enable"]}
    </Button>
  );
}
