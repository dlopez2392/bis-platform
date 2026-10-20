import { formatWhen } from "@/lib/booking/time";
import { hasStarted, sameInstant, type ActKindDef } from "./types";

/**
 * Sofía moved a booking (`reschedule_appointment`): a new booking naming the old one, and the old one
 * cancelled. Undo deletes the new one and books the old one again, in one transaction (0091), while the
 * new one is untouched and the old one is still as she left it, ahead, and free.
 */
export const bookingRescheduledKind: ActKindDef<"booking_rescheduled"> = {
  kind: "booking_rescheduled",
  control: "booking",
  describe(act, { tr, zone }) {
    return {
      verb: tr.text("aiActs.verb.rescheduled", { when: formatWhen(new Date(act.after.startsAt), zone, tr.locale) }),
      detail: tr.text("aiActs.detail.movedFrom", { when: formatWhen(new Date(act.before.startsAt), zone, tr.locale) }),
    };
  },
  stillSafe(act, facts) {
    const next = facts.bookings[act.target.bookingId];
    const old = facts.bookings[act.target.fromBookingId];
    // 0091's ZA001: the new booking must still be booked, ahead, and not itself moved on.
    if (!next || next.status !== "booked" || next.replacedBy !== null || hasStarted(next.startsAt, facts.now)) {
      return { ok: false, reason: "changed" };
    }
    // 0091's ZA002: the old one still exactly as her cancel left it.
    if (!old || old.status !== "cancelled" || !sameInstant(old.updatedAt, act.before.version)) return { ok: false, reason: "changed" };
    if (hasStarted(old.startsAt, facts.now)) return { ok: false, reason: "timePassed" };
    if (old.slotTaken) return { ok: false, reason: "oldTimeTaken" };
    return { ok: true };
  },
};
