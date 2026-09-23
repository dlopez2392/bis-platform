import type { BookingRow } from "@bis/db";
import { m } from "@/lib/messages";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";

/**
 * The customer's answer to the confirmation text, as a `DotPill` treatment.
 * A plain module, not the "use client" bookings list, so the server-rendered
 * /styleguide reads these same objects instead of a copy.
 *
 * A YES wears the automation history's `sent` colours: the text did its job.
 * A NO is the one answer on the row an operator has to act on, so it is a
 * WARNING (the `--warn-bg` ground and `--warn` dot, the Notice / work-list
 * convention) and never the history's `skipped`, the quietest treatment on
 * the row. The ink stays `text-foreground`: a sentence in `--warn` sits near
 * the AA floor, and the ground and the dot already carry the hue. Not the
 * `bg-warning/NN` utility either, which is a different, coexisting tone.
 */
export const CONFIRM_REPLY_TREATMENTS: Record<
  NonNullable<BookingRow["confirm_reply"]>,
  { label: string; chip: string; dot: string }
> = {
  yes: {
    label: m["calendar.bookings.confirmed"],
    chip: STATUS_TREATMENTS.sent.chip,
    dot: STATUS_TREATMENTS.sent.dot,
  },
  no: {
    label: m["calendar.bookings.confirmDeclined"],
    chip: "border-transparent bg-[var(--warn-bg)] text-foreground",
    dot: "bg-[var(--warn)]",
  },
};
