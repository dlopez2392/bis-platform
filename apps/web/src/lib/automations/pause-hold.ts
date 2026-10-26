/**
 * Owner answer I6: an automation due while its account is paused is HELD,
 * with S-47d's closure-hold shape (closures.ts closureVerdict): held until
 * the earlier of the next whole hour and the subject's pause deadline; skipped
 * once that deadline has passed (it is no longer timely). The release pass
 * re-runs it at held_until: still paused → held again (no write within the
 * hour); lifted (the Lift bumps held rows), paid or switch off → sent.
 */
import type { AutomationLogRow } from "@bis/db";
import { m } from "@/lib/messages";

const HOUR_MS = 60 * 60 * 1000;

/** Re-review I1: a FIXED grid, the next whole UTC hour after now. Every
 *  repeat hold within one hour computes the same instant, so writeHeld writes
 *  nothing ("same held_until", hold-or-send.ts writeHeld) and the Activity
 *  page is not re-sorted. At exactly the hour it is the NEXT hour, never now. */
export function pauseHoldUntil(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS);
}

export function pauseHold(
  pauseDeadline: Date | null | undefined, now: Date,
): { kind: "held"; until: Date } | { kind: "skipped" } {
  // An unreadable deadline (Invalid Date) is no deadline: the hold, never a send, and never an Invalid
  // Date for writeHeld to throw on. Each pass's own gate already refuses an unreadable anchor first.
  const deadline = pauseDeadline && Number.isFinite(pauseDeadline.getTime()) ? pauseDeadline.getTime() : null;
  if (deadline !== null && deadline <= now.getTime()) return { kind: "skipped" };
  const next = pauseHoldUntil(now).getTime();
  return { kind: "held", until: new Date(deadline !== null ? Math.min(next, deadline) : next) };
}

/** A pause hold still in force: holdOrSend returns `held` on this row alone,
 *  without asking the gate (re-review I1). Only OUR reason: a quiet-hours or
 *  closure hold never skips the gate this way. */
export function pauseHoldInForce(row: AutomationLogRow | null, now: Date): boolean {
  return row !== null && row.status === "held" && row.reason === m["automations.reason.heldBillingPaused"]
    && row.held_until !== null && Date.parse(row.held_until) > now.getTime();
}
