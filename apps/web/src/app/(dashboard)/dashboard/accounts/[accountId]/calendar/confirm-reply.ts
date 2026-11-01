import type { BookingRow } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";

/**
 * The customer's answer to the confirmation text, as a `DotPill` treatment's colours. A plain module,
 * not the "use client" bookings list, so the server-rendered /styleguide reads these same objects
 * instead of a copy.
 *
 * A YES wears the automation history's `sent` colours: the text did its job.
 * A NO is the one answer on the row an operator has to act on, so it is a
 * WARNING (the `--warn-bg` ground and `--warn` dot, the Notice / work-list
 * convention) and never the history's `skipped`, the quietest treatment on
 * the row. The ink stays `text-foreground`: a sentence in `--warn` sits near
 * the AA floor, and the ground and the dot already carry the hue. Not the
 * `bg-warning/NN` utility either, which is a different, coexisting tone.
 *
 * S-10 review M-5: carries chip/dot only, never a `label` — the real client
 * call sites (agenda-view.ts's `confirmWord`, job-drawer.tsx's own
 * `makeTr(locale, pseudo).text(...)`) already translate the word themselves
 * and never read one off this map; a module-level English `label` here was
 * dead code kept alive only by the styleguide's own demo spread, and an
 * unfixable G3 violation (this module is reachable from client code, so it
 * cannot be agency-only-exempted, yet nothing client-facing ever asked it
 * for English). `confirmReplyLabel` below is what a caller that DOES want
 * the word — today, only the styleguide demo — asks instead.
 */
export const CONFIRM_REPLY_TREATMENTS: Record<
  NonNullable<BookingRow["confirm_reply"]>,
  { chip: string; dot: string }
> = {
  yes: {
    chip: STATUS_TREATMENTS.sent.chip,
    dot: STATUS_TREATMENTS.sent.dot,
  },
  no: {
    chip: "border-transparent bg-[var(--warn-bg)] text-foreground",
    dot: "bg-[var(--warn)]",
  },
};

/** The word for a confirm reply, in `locale` — what `CONFIRM_REPLY_TREATMENTS` used to carry as a
 *  fixed English `label` before S-10 review M-5. */
export function confirmReplyLabel(reply: NonNullable<BookingRow["confirm_reply"]>, locale: Locale): string {
  return t(m, reply === "yes" ? "calendar.bookings.confirmed" : "calendar.bookings.confirmDeclined", locale);
}
