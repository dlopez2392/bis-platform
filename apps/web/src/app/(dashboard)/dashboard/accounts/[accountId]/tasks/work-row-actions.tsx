"use client";
//
// The client boundary for the To do screen's three actions (Work Queue
// Task 4). Follows `bookings-list.tsx`'s own precedent exactly: the server
// actions are passed down as PROPS, already bound to `accountId` by the
// server component that renders this (`work-list.tsx`) — never imported
// into this file directly. `useTransition` disables the buttons while
// pending; the result is toasted, never swallowed.
//
// Exactly one action per row SOURCE, not a menu of all three everywhere:
// - task         → "Done" (with a real undo: reopen the same task).
// - conversation → "Not now" (with a real undo: complete the task it just
//                  created). Bookings are deliberately excluded from "Not
//                  now" — the suppression a dismissal task relies on is
//                  explicitly NOT wired for bookings (a stale booking's
//                  `status` is what makes it stop matching), so a "Not now"
//                  task against a booking row would create a task and leave
//                  the same stale booking showing forever regardless.
// - booking      → the two close-out buttons, terminal, no undo (matches
//                  the calendar screen's own posture: once a booking leaves
//                  "booked" there is no un-complete/un-no-show path).
import { useTransition } from "react";
import { toast } from "sonner";
import type { WorkSource } from "@bis/db";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import type { ActionResult, DismissResult } from "./actions";

export function WorkRowActions({
  source,
  rawId,
  contactId,
  label,
  completeWorkTask,
  reopenWorkTask,
  dismissToTask,
  closeOutBooking,
}: {
  source: WorkSource;
  /** The row's own database id with the `"${source}:"` prefix stripped —
   *  `WorkRow.id` is `\`${source}:${dbId}\`` (work-queue.ts); the actions
   *  below all take the bare id. */
  rawId: string;
  contactId: string | null;
  /** The row's own already-rendered primary sentence — reused verbatim as
   *  the "Not now" task's title (spec §3: "the task title is the row's own
   *  label verbatim"), never re-templated here. */
  label: string;
  completeWorkTask: (taskId: string) => Promise<ActionResult>;
  reopenWorkTask: (taskId: string) => Promise<ActionResult>;
  dismissToTask: (row: { source: WorkSource; contactId: string | null; title: string }) => Promise<DismissResult>;
  closeOutBooking: (bookingId: string, status: "completed" | "no_show") => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();

  function runComplete() {
    startTransition(async () => {
      const result = await completeWorkTask(rawId);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(m["work.done.toast"], {
        action: {
          label: m["common.undo"],
          onClick: () => void reopenWorkTask(rawId).then((r) => { if (!r.ok) toast.error(r.error); }),
        },
      });
    });
  }

  function runDismiss() {
    startTransition(async () => {
      const result = await dismissToTask({ source, contactId, title: label });
      if (!result.ok) { toast.error(result.error); return; }
      const newTaskId = result.taskId;
      toast.success(m["work.notNow.toast"], {
        action: {
          label: m["common.undo"],
          onClick: () => void completeWorkTask(newTaskId).then((r) => { if (!r.ok) toast.error(r.error); }),
        },
      });
    });
  }

  function runBooking(status: "completed" | "no_show") {
    startTransition(async () => {
      const result = await closeOutBooking(rawId, status);
      if (result.ok) toast.success(m["work.booking.toast"]);
      else toast.error(result.error);
    });
  }

  if (source === "task") {
    return (
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={runComplete}>
        {m["work.done"]}
      </Button>
    );
  }

  if (source === "conversation") {
    return (
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={runDismiss}>
        {m["work.notNow"]}
      </Button>
    );
  }

  // source === "booking" — terminal, no undo (see file doc above).
  return (
    <div className="flex shrink-0 gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => runBooking("completed")}>
        {m["work.booking.completed"]}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => runBooking("no_show")}>
        {m["work.booking.noShow"]}
      </Button>
    </div>
  );
}
