import { m } from "@/lib/messages";

export type OptOutResult = { ok: true } | { ok: false; error: string };
export type OptOutSave = (optedOut: boolean) => Promise<OptOutResult>;

/** The slice of sonner's `toast` this uses, injected so it is testable
 *  without a DOM. */
export type OptOutToast = {
  success: (message: string, opts: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};

/** One write: `true` on success, and on failure the box is put back to
 *  `!optedOut` and the operator is told why. */
async function write(
  optedOut: boolean, save: OptOutSave, show: (checked: boolean) => void, toast: OptOutToast,
): Promise<boolean> {
  let result: OptOutResult;
  try {
    result = await save(optedOut);
  } catch {
    // A stale tab posting a server-action id from before a redeploy REJECTS
    // rather than resolving (the notifyActionResult reasoning in
    // lib/forms/action-feedback.ts) — that must reach the operator.
    show(!optedOut);
    toast.error(m["inline.crashed"]);
    return false;
  }
  if (!result.ok) {
    show(!optedOut);
    toast.error(result.error);
    return false;
  }
  return true;
}

/**
 * The "No marketing emails" switch: a reversible action, so it runs at once
 * and offers Undo (DESIGN.md rule 6) — the same shape as the website
 * assistant's switch in voice/voice-settings.tsx. The box moves before the
 * server answers (`show(optedOut)`) and moves back if the write fails.
 *
 * Undo writes the opposite value and does not offer an undo of its own; a
 * failed undo leaves the box where the server still has it.
 */
export async function flipMarketingOptOut(
  optedOut: boolean, save: OptOutSave, show: (checked: boolean) => void, toast: OptOutToast,
): Promise<void> {
  show(optedOut);
  if (!(await write(optedOut, save, show, toast))) return;
  toast.success(
    m[optedOut ? "contact.marketingOptOut.onToast" : "contact.marketingOptOut.offToast"],
    {
      action: {
        label: m["common.undo"],
        // Returns the promise (sonner ignores it) so a caller can await it.
        onClick: async () => {
          show(!optedOut);
          await write(!optedOut, save, show, toast);
        },
      },
    },
  );
}
