/**
 * One write at a time for a control that runs at once and offers Undo
 * (DESIGN.md rule 6). Moved here from the retired 0049 switch's module
 * (review R3-M7): the Texts row, the Check number state and the Email row
 * share it.
 *
 * `busy` is a ref, not the transition's `pending`: an Undo closure is built
 * during an EARLIER write, so a `pending` captured then is stale by the time
 * the toast's button is clicked; a ref is read at click time. `start` is the
 * control's `startTransition`, so it still reads `pending` while the write
 * runs. Answers whether it took the work: `false` means refused, which an
 * Undo turns into a word to the operator.
 */
export type ToastLike = {
  success: (message: string, opts?: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};

export function runGuarded(
  busy: { current: boolean },
  start: (work: () => Promise<void>) => void,
  work: () => Promise<void>,
): boolean {
  if (busy.current) return false;
  busy.current = true;
  start(async () => {
    try {
      await work();
    } finally {
      busy.current = false;
    }
  });
  return true;
}
