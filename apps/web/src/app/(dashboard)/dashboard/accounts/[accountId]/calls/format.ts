import type { CallListRow, CallOutcome } from "@bis/db";
import { m } from "@/lib/messages";

/**
 * Outcome treatment, shared by the list (`calls-table.tsx`) and the detail
 * page (`[callId]/page.tsx`) — a client arrives at the detail page by
 * clicking a row, and an outcome that changed colour or label on the way in
 * would read as a different outcome. This used to be defined twice, byte-
 * identical, with a comment in each copy asking a reviewer to keep them in
 * sync; nothing ever enforced that, so it is one map now.
 *
 * The hue lives in the DOT and the chip's border/tint, never in the label
 * text: `--success` on a light surface measures ~3.4:1, below AA for text
 * this size. A colored dot is a graphical object, held to 3:1, and it carries
 * the same "which outcome is this" signal at a glance.
 *
 * `booked` is the positive one and is the only outcome with a filled chip —
 * it should be the thing the eye finds first in a column of fifty rows.
 * `abandoned` and `spam` deliberately recede: they are the rows a client
 * should NOT be drawn to.
 *
 * `transferred` (0037) joins the positive band, not the receding one: the
 * caller reached a person, which is the best thing that can happen on a call
 * the receptionist could not close itself. It shares `booked`'s success hue
 * deliberately rather than taking a new one — the only unused hue left is
 * `warning`, which would say something is wrong, and the two collisions
 * available are not equally harmless: mistaking a transfer for a booking at a
 * glance reads "the business got what it wanted", which is true of both,
 * while mistaking it for a `lead` would imply captured contact details that
 * nobody ever took. The fill is what separates them — `booked` keeps the
 * sole filled chip — and the WORD is what actually distinguishes them, per
 * DESIGN.md rule 3.
 */
export const OUTCOMES: Record<CallOutcome, { label: string; dot: string; chip: string }> = {
  booked: {
    label: m["calls.outcome.booked"],
    dot: "bg-success",
    chip: "border-success/30 bg-success/10 text-foreground",
  },
  lead: {
    label: m["calls.outcome.lead"],
    dot: "bg-primary",
    chip: "border-primary/30 bg-primary/5 text-foreground",
  },
  message: {
    label: m["calls.outcome.message"],
    dot: "bg-accent",
    chip: "border-accent/30 bg-accent/5 text-foreground",
  },
  transferred: {
    label: m["calls.outcome.transferred"],
    dot: "bg-success",
    chip: "border-success/30 bg-success/5 text-foreground",
  },
  abandoned: {
    label: m["calls.outcome.abandoned"],
    dot: "bg-muted-foreground/60",
    chip: "border-border bg-transparent text-muted-foreground",
  },
  spam: {
    label: m["calls.outcome.spam"],
    dot: "bg-destructive",
    chip: "border-destructive/25 bg-transparent text-muted-foreground",
  },
};

/** What a cell shows when there is no duration to show. Exported so the call
 *  detail page (Task 11) renders the same placeholder as the list rather than
 *  a second, drifting one. */
export const DURATION_UNKNOWN = "—";

/**
 * `duration_secs` → "m:ss". Deliberately NOT rolled up into h:mm:ss past an
 * hour ("61:01", not "1:01:01"): every other row in the log is minutes-scale,
 * and a mixed-unit column stops being scannable.
 *
 * Null is the common case, not an error — an abandoned call is finished with
 * no duration, and a call still in flight has no `ended_at` yet. Rendering
 * either as "0:00" would claim a measured, instantaneous call.
 */
export function formatDuration(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs) || secs < 0) return DURATION_UNKNOWN;
  const total = Math.floor(secs);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Only the two fields the label is derived from, so a `CallListRow` and the
 *  wider `CallDetailRow` (Task 11) both satisfy it, and a test fixture does
 *  not have to invent an id and a timestamp to name a caller. */
type CallerFields = Pick<CallListRow, "caller_e164" | "contact">;

/**
 * The list's own "when" — same option shape as `lib/booking/time.ts`'s
 * `formatWhen` (locale pinned to "en-US", zone pinned to the account's own,
 * not the viewer's) plus `year: "numeric"`. NOT a parameter added to
 * `formatWhen` itself: that formatter also renders confirmation and reminder
 * emails about a booking days out, where every date is implicitly "this
 * year" and a year would be clutter. This list scrolls back across years —
 * without one, a call from 2024 and one from 2026 render identically.
 */
export function formatCallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(iso));
}

/**
 * Who rang: the matched contact's name, else the number they rang from, else
 * "Unknown caller" (a withheld/blocked caller ID writes `caller_e164` null).
 *
 * NOT `contactDisplayName`, whose "(no name)" fallback would win over a
 * perfectly good phone number: a call can create a contact from nothing but a
 * spoken email address, so a nameless linked contact is a real shape here.
 */
export function callerLabel(row: CallerFields): string {
  const name = [row.contact?.first_name, row.contact?.last_name]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  if (name) return name;
  const number = row.caller_e164?.trim();
  if (number) return number;
  return m["calls.unknownCaller"];
}
