import { toast } from "sonner";
import type { Tr } from "@/lib/record/copy";
import type { FeedActionResult, FeedUndo } from "./feed-actions";

/**
 * F-048 part 2: what the "Bookings on your phone" card's buttons DO, as plain async functions
 * (assign-handlers.ts's shape), so the toast, its Undo and a refusal are tested without a DOM. Client code:
 * it imports only TYPES from the actions file and nothing from the card's server read.
 */

/** = CALENDAR_FEED_UNDO_SECONDS × 1000 (pinned in the test): the Undo is offered only while the database would honour it. */
export const FEED_TOAST_MS = 30_000;
type Run = () => Promise<FeedActionResult>;
type UndoRun = (undo: FeedUndo) => Promise<FeedActionResult>;

async function settle(run: Run, tr: Tr): Promise<FeedActionResult | null> {
  try {
    const r = await run();
    if (!r.ok) { toast.error(tr.text(r.error)); return null; }
    return r;
  } catch {
    toast.error(tr.text("calendar.feed.error.failed"));
    return null;
  }
}

/** Make: no toast (the card itself changes). */
export async function runMake(run: Run, tr: Tr, refresh: () => void): Promise<void> {
  if (await settle(run, tr)) refresh();
}

/** Replace and Turn off: run at once, then a toast with Undo (DESIGN.md rule 6). */
export async function runWithUndo(
  run: Run, undo: UndoRun, tr: Tr,
  message: "calendar.feed.toast.replaced" | "calendar.feed.toast.turnedOff", refresh: () => void,
): Promise<void> {
  const r = await settle(run, tr);
  if (!r || !r.ok) return;
  refresh();
  const u = r.undo;
  if (!u) return;
  toast.success(tr.text(message), {
    duration: FEED_TOAST_MS,
    action: {
      label: tr.text("calendar.feed.undo"),
      onClick: () => {
        void settle(() => undo(u), tr).then((back) => {
          if (back) { toast.success(tr.text("calendar.feed.toast.restored")); refresh(); }
        });
      },
    },
  });
}
