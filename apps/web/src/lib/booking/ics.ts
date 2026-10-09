/**
 * F-048's add-to-calendar file (RFC 5545): one VEVENT, published, for the
 * customer's own phone calendar. Pure: the route reads the row and decides
 * every value; this only writes the format.
 *
 * TIME: DTSTART/DTEND/DTSTAMP are UTC instants ("FORM #2", §3.3.5), never a
 * TZID-qualified wall time. A booking's `starts_at` is already the exact
 * instant the slot engine resolved from the account's wall clock
 * (`zonedTimeToUtc`), DST included; written as UTC, no calendar app's own
 * zone rules are ever consulted to turn it back into an instant, so nothing
 * downstream can move it by an hour. A TZID would also oblige a VTIMEZONE
 * definition in this same file (§3.2.19), a second copy of the zone's rules
 * that could disagree with the first. The account's own wall-clock time is
 * carried in words, in DESCRIPTION, by the caller.
 *
 * UID + SEQUENCE: the caller passes one UID for a booking and every booking
 * that replaced it by reschedule, and a SEQUENCE that grows with each move,
 * which is what lets a calendar update the event it already holds rather than
 * add a second one (ASSUMPTION: that each calendar app honours UID/SEQUENCE
 * on a re-imported PUBLISH file; RFC 5546 §2.1.5 defines it for iTIP, and no
 * app's import behaviour was verified here).
 *
 * Invalid input fails CLOSED: `null`, never a file at a NaN or inverted time.
 */
export type BookingIcsInput = {
  uid: string;
  /** 0 for the original booking, +1 per reschedule. */
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  /** DTSTAMP: when this file's content was produced. */
  stampedAt: Date;
  summary: string;
  description?: string;
  url?: string;
};

const PRODID = "-//BIS//Bookings//EN";
const UID_DOMAIN = "bookings.bis-rgv.com";

/** One UID per appointment, from the id of the FIRST booking in its
 *  reschedule chain (the caller resolves the chain). */
export function bookingUid(rootBookingId: string): string {
  return `${rootBookingId}@${UID_DOMAIN}`;
}

const valid = (d: Date) => d instanceof Date && Number.isFinite(d.getTime());

/** YYYYMMDDTHHMMSSZ, from the UTC fields only. Seconds are kept: a slot
 *  engine instant is minute-aligned, and a DTSTAMP is not. */
function utcStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** TEXT escaping (§3.3.11). Every line break becomes the two characters
 *  `\n`, which is what keeps a value from starting a property of its own. */
function text(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** URI values are not TEXT, so they are not escaped, but a line break in one
 *  would still start a new property: refused by dropping the property. */
function uri(value: string): string | null {
  return /[\r\n]/.test(value) ? null : value;
}

/**
 * Folding (§3.1): no line longer than 75 OCTETS, continued with CRLF + one
 * space. Measured in UTF-8 bytes, and never inside a character: a Spanish
 * business name is exactly where a character-count fold would split "ñ".
 */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74; // the leading space of a continuation line is one octet
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function bookingIcs(input: BookingIcsInput): string | null {
  if (!valid(input.startsAt) || !valid(input.endsAt) || !valid(input.stampedAt)) return null;
  if (input.endsAt.getTime() <= input.startsAt.getTime()) return null;
  if (!Number.isInteger(input.sequence) || input.sequence < 0) return null;
  if (!input.uid || /[\r\n]/.test(input.uid)) return null;

  const url = input.url ? uri(input.url) : null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${utcStamp(input.stampedAt)}`,
    `DTSTART:${utcStamp(input.startsAt)}`,
    `DTEND:${utcStamp(input.endsAt)}`,
    `SUMMARY:${text(input.summary)}`,
    ...(input.description ? [`DESCRIPTION:${text(input.description)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
