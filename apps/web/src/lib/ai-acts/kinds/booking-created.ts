import { formatWhen } from "@/lib/booking/time";
import { hasStarted, type ActKindDef } from "./types";

/** Sofía booked a time (`book_appointment`). Undo cancels it while it is still booked and ahead (0091). */
export const bookingCreatedKind: ActKindDef<"booking_created"> = {
  kind: "booking_created",
  control: "booking",
  describe(act, { tr, zone }) {
    return { verb: tr.text("aiActs.verb.booked", { when: formatWhen(new Date(act.after.startsAt), zone, tr.locale) }), detail: null };
  },
  stillSafe(act, facts) {
    const b = facts.bookings[act.target.bookingId];
    // Gone, or one the reader cannot see (RLS): no Undo is offered for what the page cannot vouch for.
    if (!b) return { ok: false, reason: "changed" };
    if (b.status !== "booked") return { ok: false, reason: "alreadyCancelled" };
    if (hasStarted(b.startsAt, facts.now)) return { ok: false, reason: "alreadyHappened" };
    return { ok: true };
  },
};
