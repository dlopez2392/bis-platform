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
//
// The two booking buttons are the one place on this dense, fast-triage row
// where a misclick is genuinely dangerous: both are irreversible AND both
// read the contact's own email/phone to arm a different outbound customer
// message — Completed makes the booking eligible for the review-request
// automation, No-show for the separate no-show nudge. They therefore do NOT
// share one visual treatment the way Done/Not now do. `variant="destructive"`
// on No-show and a distinct, outcome-naming toast on each is the deliberate
// exception to "everything but one primary is ghost" below — matching the
// vocabulary `bookings-list.tsx`'s own `STATUS_VARIANT` already uses for
// these same two outcomes (`completed: "secondary"`, `no_show: "destructive"`).
// No confirmation dialog either way: DESIGN.md rule 6 bans reflexive "Are you
// sure?", and terminal-by-construction is this spec's own stance.
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
          // Inside a SECOND transition of its own — not fired-and-forgotten
          // outside `pending` — so the row's button stays disabled for the
          // duration of the undo too, not just the original action.
          onClick: () => startTransition(async () => {
            const r = await reopenWorkTask(rawId);
            if (!r.ok) toast.error(r.error);
          }),
        },
      });
    });
  }

  function runDismiss() {
    startTransition(async () => {
      const result = await dismissToTask({ source, contactId, title: label });
      if (!result.ok) { toast.error(result.error); return; }
      const newTaskId = result.taskId;
      // The action reports whether a due date actually got set (the zone
      // could be unresolvable) — "Moved to tomorrow." is a lie on that
      // degrade path, since nothing moved and no date was set.
      toast.success(result.dueAt ? m["work.notNow.toast"] : m["work.notNow.toastNoDate"], {
        action: {
          label: m["common.undo"],
          onClick: () => startTransition(async () => {
            const r = await completeWorkTask(newTaskId);
            if (!r.ok) toast.error(r.error);
          }),
        },
      });
    });
  }

  function runBooking(status: "completed" | "no_show") {
    startTransition(async () => {
      const result = await closeOutBooking(rawId, status);
      if (!result.ok) { toast.error(result.error); return; }
      // Names the outcome that was actually recorded — these two buttons
      // each arm a different outbound customer message and look nearly
      // identical, so a wrong click must be visible immediately rather than
      // hidden behind one shared "Updated." toast.
      toast.success(
        status === "completed" ? m["work.booking.completed.toast"] : m["work.booking.noShow.toast"],
      );
    });
  }

  if (source === "task") {
    return (
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={runComplete}>
        {m["work.done"]}
      </Button>
    );
  }

  if (source === "conversation") {
    return (
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={runDismiss}>
        {m["work.notNow"]}
      </Button>
    );
  }

  // source === "booking" — terminal, no undo (see file doc above). Ghost for
  // Completed (the everything-but-one-primary default); `destructive` for
  // No-show is the deliberate exception that makes the two visually
  // distinguishable, not an accident of copy-paste.
  return (
    <div className="flex shrink-0 gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => runBooking("completed")}>
        {m["work.booking.completed"]}
      </Button>
      <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => runBooking("no_show")}>
        {m["work.booking.noShow"]}
      </Button>
    </div>
  );
}
