"use client";

import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Check, SkipForward, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import type { SetupTickAction, SetupTick } from "./setup-panel";

/**
 * The only interactive island on the setup page. Everything else — ten
 * cards, their derived states, every link — is server-rendered, so this is
 * the whole client bundle the page pays for.
 *
 * A real `<form action={…}>`, not an onClick: it is the same idiom
 * voice-settings.tsx uses (an async closure that awaits the Result-typed
 * action and reports failure through a toast), it gives `useFormStatus` a
 * pending state to disable against, and it keeps the button working as a
 * plain submit. The explicit `router.refresh()` is what re-derives the other
 * nine cards — the tick action deliberately does not `revalidatePath`,
 * because the page is `force-dynamic` and the refresh is a client concern.
 */
export function SetupTickButton({
  action, tick, done, label,
}: {
  action: SetupTickAction;
  tick: SetupTick;
  /** The value to WRITE — i.e. the opposite of the current state. */
  done: boolean;
  label: string;
}) {
  const router = useRouter();
  return (
    <form
      action={async () => {
        // The catch exists for the stale-deployment case — a rejected action
        // call must toast, never vanish (2026-08-29, live).
        let result: Awaited<ReturnType<typeof action>>;
        try {
          result = await action(tick, done);
        } catch {
          toast.error(m["common.actionCrashed"]);
          return;
        }
        if (!result.ok) {
          toast.error(m["setup.tickFailed"]);
          return;
        }
        router.refresh();
      }}
    >
      <PendingButton label={label} tick={tick} done={done} />
    </form>
  );
}

function PendingButton({
  label, tick, done,
}: { label: string; tick: SetupTick; done: boolean }) {
  const { pending } = useFormStatus();
  // Undoing anything reads as an undo; the forward direction gets the verb
  // that matches what it does — skipping past a step vs. confirming one.
  const Icon = !done ? Undo2 : tick === "emailSkipped" ? SkipForward : Check;
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? null : <Icon aria-hidden />}
      {pending ? m["common.saving"] : label}
    </Button>
  );
}
