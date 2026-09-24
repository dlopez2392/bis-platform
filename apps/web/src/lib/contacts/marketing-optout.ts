import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";

/**
 * "Off since Sep 3, 2026" — the day `marketing_email_opted_out_at` was
 * stamped, as a calendar date in the ACCOUNT's zone (`formatDateInZone`, the
 * account-scoped date formatter; a stop recorded at 9 PM in Chicago is that
 * day, not UTC's tomorrow). Null without a stamp — and for a stamp that does
 * not parse, because `formatDateInZone` THROWS on one and this renders inside
 * the drawer, where a throw would take the whole panel down over one line.
 */
export function optOutSinceLine(optedOutAt: string | null, timeZone: string): string | null {
  if (optedOutAt === null || Number.isNaN(Date.parse(optedOutAt))) return null;
  return m["contact.marketingOptOut.since"].replace("{date}", formatDateInZone(optedOutAt, timeZone));
}

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
 *
 * Undo's write goes through `run` — the switch passes the SAME guard its tick
 * runs through (`runGuarded`), so an Undo clicked while a tick is still saving
 * is refused rather than racing it (#122 m5). The default runs it at once.
 */
export async function flipMarketingOptOut(
  optedOut: boolean, save: OptOutSave, show: (checked: boolean) => void, toast: OptOutToast,
  run: (work: () => Promise<void>) => unknown = (work) => work(),
): Promise<void> {
  show(optedOut);
  if (!(await write(optedOut, save, show, toast))) return;
  toast.success(
    m[optedOut ? "contact.marketingOptOut.onToast" : "contact.marketingOptOut.offToast"],
    {
      action: {
        label: m["common.undo"],
        // Returns what `run` returns (sonner ignores it) so a caller can await
        // it when the runner hands back the work's promise.
        onClick: () => run(async () => {
          show(!optedOut);
          await write(!optedOut, save, show, toast);
        }),
      },
    },
  );
}

/**
 * One write at a time. `busy` is a ref, not the transition's `pending`: the
 * Undo closure is built during an EARLIER flip, so a `pending` captured then
 * is stale by the time the toast's button is clicked; a ref is read at click
 * time. `start` is the switch's `startTransition`, so the box still reads
 * `pending` (and disables) while the write runs.
 */
export function runGuarded(
  busy: { current: boolean },
  start: (work: () => Promise<void>) => void,
  work: () => Promise<void>,
): void {
  if (busy.current) return;
  busy.current = true;
  start(async () => {
    try {
      await work();
    } finally {
      busy.current = false;
    }
  });
}
