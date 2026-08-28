import type { CallListRow } from "@bis/db";
import { m } from "@/lib/messages";

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
