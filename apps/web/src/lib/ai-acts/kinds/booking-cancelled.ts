import { formatWhen } from "@/lib/booking/time";
import { hasStarted, sameInstant, type ActKindDef } from "./types";

/**
 * Sofía cancelled a booking (`cancel_appointment`). Undo books it again while it is still HER cancel (the
 * version), not replaced, ahead, and its slot is free (0091). One more reason the SQL does not refuse but
 * the display does: when the customer has booked another future time since, putting this one back would
 * leave them with two (plan Task 5 item 1, review minor).
 */
export const bookingCancelledKind: ActKindDef<"booking_cancelled"> = {
  kind: "booking_cancelled",
  control: "booking",
  describe(act, { tr, zone }) {
    return { verb: tr.text("aiActs.verb.cancelled", { when: formatWhen(new Date(act.before.startsAt), zone, tr.locale) }), detail: null };
  },
  stillSafe(act, facts) {
    const id = act.target.bookingId;
    const b = facts.bookings[id];
    if (!b) return { ok: false, reason: "changed" };
    if (b.status === "booked") return { ok: false, reason: "rebooked" };
    if (hasStarted(b.startsAt, facts.now)) return { ok: false, reason: "timePassed" };
    if (b.status !== "cancelled" || !sameInstant(b.updatedAt, act.after.version) || b.replacedBy !== null) return { ok: false, reason: "changed" };
    if (b.slotTaken) return { ok: false, reason: "timeTaken" };
    if (facts.futureBooked.some((other) => other !== id)) return { ok: false, reason: "otherBooking" };
    return { ok: true };
  },
};
