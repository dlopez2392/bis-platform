"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import type { SetupGoLiveAction } from "./setup-panel";

/**
 * The button that turns a client's phone line on.
 *
 * `disabled` here is COURTESY, not control. The action it calls re-derives
 * every prerequisite from live rows at click time and refuses on its own
 * evidence (see goLiveAction in ./actions.ts) — which is the only reason it is
 * safe to hand this button a boolean computed during a render that went stale
 * the moment it painted.
 *
 * The failure is rendered inline rather than toasted, unlike the tick button
 * beside it. A toast is right for "that didn't save, try again"; this one
 * answers "why didn't my client go live", which the operator needs to still be
 * on screen while they go read the steps above it. Same `<form action={…}>`
 * idiom otherwise, so `useFormStatus` has a pending state to disable against
 * and the button keeps working as a plain submit.
 */
export function SetupGoLiveButton({
  action, disabled,
}: {
  action: SetupGoLiveAction;
  /** Prerequisites unmet by the page's derivation. */
  disabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <form
        action={async () => {
          setError(null);
          // The catch exists for the stale-deployment case: a tab loaded
          // before a redeploy REJECTS the action call outright, and without
          // it this button fails with no error at all (2026-08-29, live).
          let result: Awaited<ReturnType<typeof action>>;
          try {
            result = await action();
          } catch {
            setError(m["common.actionCrashed"]);
            return;
          }
          if (!result.ok) {
            setError(result.error);
            return;
          }
          // Re-derives all nine cards, including this one — go_live flipping
          // to done is what replaces this button with a tick.
          router.refresh();
        }}
      >
        <PendingButton disabled={disabled} />
      </form>

      {/* Hue in the border and the fill, never in the text: `--warning`
          measures ~3.6:1 on this card, fine for a graphical mark and below AA
          for a sentence. Same rule the panel's state chips follow. */}
      {error !== null ? (
        <Notice tone="warn" className="text-foreground">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

function PendingButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? null : <Rocket aria-hidden />}
      {pending ? m["setup.goLive.pending"] : m["setup.goLive.button"]}
    </Button>
  );
}
