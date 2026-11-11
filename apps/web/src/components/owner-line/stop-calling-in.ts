// "Stop calling in" (F-032 §3.1; DESIGN rule 6): the removal waits behind a 10-second Undo toast and runs when the
// toast closes without Undo. A tab closed (or left by a full page load) inside that window never closes the toast, so
// on its own the revocation would be silently cancelled (design review Important 3). The page's `pagehide` forces it
// through, through the Preferences panel's own flushOnPageHide. It runs at most once, whichever comes first; an Undo
// before that means it never runs. No React here, so every path is a plain assertion (stop-calling-in.test.ts).
import { flushOnPageHide } from "@/components/preferences/preference-handlers";

export const STOP_CALLING_IN_UNDO_MS = 10_000;

export type DeferredRemoval = {
  /** The toast closed without Undo (timed out, swiped, closed): run the removal, once. */
  settle: () => void;
  /** Undo. True when nothing has been removed; false when the removal already went through (pagehide got there). */
  undo: () => boolean;
};

export function deferredRemoval(
  commit: () => void, target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
): DeferredRemoval {
  let done = false;
  const detach = flushOnPageHide(target, () => settle());
  function settle() {
    if (done) return;
    done = true;
    detach();
    commit();
  }
  return {
    settle,
    undo: () => {
      if (done) return false;
      done = true;
      detach();
      return true;
    },
  };
}
