import type { EmailView } from "@/lib/consent/email-view";
import type { InboundMeta } from "./inbound-meta";

/**
 * Fix round 1 (UI review, important #2): a message's `meta.consent` is a
 * FILING-TIME snapshot — what `file.ts` recorded the moment the reply
 * landed. By the time anyone opens the thread, a staff Undo may have lifted
 * it, a later reply may have superseded it, or the 7-day staff-Undo window
 * (`lib/consent/email-view.ts`'s `REPLY_STOP_WINDOW_MS`) may have closed.
 * This reads the address's CURRENT state (`EmailView`, from `readEmailView`,
 * computed server-side in `page.tsx` against the real clock) against this
 * message's own snapshot, so the notice never shows stale information:
 *
 * - `stopIsCurrent`: true only when the address is STILL stopped by THIS
 *   message's own event (`consent.eventId` matches `view.eventId`) AND that
 *   stop's method is still read as a reply (`view.how.kind === "reply"`) —
 *   never merely "some stop exists". A staff Undo moves the newest row to
 *   `allowed`; a later stop (reply or otherwise) moves it to a DIFFERENT
 *   event id or method; either way this is false.
 * - `initiallyExpired`: only meaningful when `stopIsCurrent` — the SAME
 *   `EmailView` already carries whether the 7-day window has closed
 *   (`how.expired`, computed against the server's own `now`).
 * - `chipActionable`: only meaningful for the "maybe" chip — true while the
 *   address is CURRENTLY `allowed`, so "Stop emails" never offers to stop
 *   an address that is already stopped by something else.
 */
export type StopState = { stopIsCurrent: boolean; initiallyExpired: boolean; chipActionable: boolean };

const REST: StopState = { stopIsCurrent: false, initiallyExpired: false, chipActionable: false };

export function currentStopState(consent: InboundMeta["consent"], view: EmailView | undefined): StopState {
  if (consent.kind === "stopped") {
    if (view && view.kind === "stopped" && view.how.kind === "reply" && view.eventId === consent.eventId) {
      return { stopIsCurrent: true, initiallyExpired: view.how.expired, chipActionable: false };
    }
    return REST;
  }
  if (consent.kind === "maybe") {
    return { ...REST, chipActionable: view?.kind === "allowed" };
  }
  return REST;
}
