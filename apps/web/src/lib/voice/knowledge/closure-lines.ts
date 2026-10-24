// S-47d (spec 5.4.1; plan "The model, The prompt lines"): the TODAY line and the CLOSED DAYS block. Model input,
// not catalogue copy (spec 6): every string here is pinned word for word by closure-lines.test.ts and
// system-prompt.test.ts. English only, as S-47c's lines are. Pure; relative imports only (scripts/sofia-corpus.ts
// loads system-prompt.ts under tsx).
import { clockAt, daysBetweenKeys, monthDayOf, weekdayNameOf } from "./hours";
import { dayKey, type ClosedDay, type EffectiveStatus } from "../../business-status/status";

export const CLOSED_DAYS_HEADING =
  "CLOSED DAYS (the business is closed all day on these dates, and no time on them can be booked):";

/** One upcoming closed range as the knowledge payload stores it: the range and the exact line she reads. */
export type ClosedDayLine = ClosedDay & { line: string };

/** "tomorrow at 8:00 AM" / "on Monday at 8:00 AM" / "on Monday, January 4 at 8:00 AM"; without a known time the
 *  same without " at {time}". Days are counted on the zone's calendar. 0 days (SD15) says "today". */
export function reopeningPhrase(reopensAt: Date, timeKnown: boolean, timezone: string, now: Date): string {
  const key = dayKey(reopensAt, timezone);
  const dd = daysBetweenKeys(dayKey(now, timezone), key);
  const day = dd <= 0 ? "today"
    : dd === 1 ? "tomorrow"
      : dd <= 6 ? `on ${weekdayNameOf(key)}`
        : `on ${weekdayNameOf(key)}, ${monthDayOf(key)}`;
  return timeKnown ? `${day} at ${clockAt(reopensAt, timezone)}` : day;
}

// minors-1b item 9: one string per value, not a [behind, late] pair that was always the same string
// twice — collapsing it changes no prompt text (PRE_S47D_DIGEST/S47C/S47B stay byte-identical).
const LATE_WORDS: Record<15 | 30 | 60 | 120, string> = {
  15: "about 15 minutes",
  30: "about 30 minutes",
  60: "about an hour",
  120: "more than an hour",
};
const REASON_WORDS = { holiday: " for a holiday", vacation: " for vacation", other: "" } as const;

/** The TODAY line for a status that is not open; null for open. */
export function todayLine(s: EffectiveStatus, timezone: string, now: Date): string | null {
  switch (s.state) {
    case "open":
      return null;
    case "closed_today":
      return `TODAY: The business is closed today. It opens again ${reopeningPhrase(s.reopensAt, s.reopensTimeKnown, timezone, now)}.`;
    case "storm":
      return s.reopensAt === null
        ? "TODAY: The business is closed because of a storm, until further notice."
        : `TODAY: The business is closed because of a storm. It opens again ${reopeningPhrase(s.reopensAt, s.reopensTimeKnown, timezone, now)}.`;
    case "running_late": {
      const late = LATE_WORDS[s.lateMinutes];
      return `TODAY: The team is running ${late} behind today. If someone asks about a visit or appointment today, tell them it may start ${late} late.`;
    }
    case "closed_day":
      return `TODAY: The business is closed all day today${s.reason ? REASON_WORDS[s.reason] : ""}. It opens again ${reopeningPhrase(s.reopensAt, s.reopensTimeKnown, timezone, now)}.`;
  }
}

/** "- Thursday, December 24, 2026 (holiday)"; a range says the year once when both dates share it, else on each. */
export function closedDayLine(d: ClosedDay): string {
  const first = `${weekdayNameOf(d.starts_on)}, ${monthDayOf(d.starts_on)}`;
  const y1 = d.starts_on.slice(0, 4);
  const y2 = d.ends_on.slice(0, 4);
  const dates = d.starts_on === d.ends_on ? `${first}, ${y1}`
    : y1 === y2 ? `${first} to ${weekdayNameOf(d.ends_on)}, ${monthDayOf(d.ends_on)}, ${y2}`
      : `${first}, ${y1} to ${weekdayNameOf(d.ends_on)}, ${monthDayOf(d.ends_on)}, ${y2}`;
  return `- ${dates}${d.reason ? ` (${d.reason})` : ""}`;
}

/** [] for none; else ["", heading, each stored line], the shape of every S-47c block. */
export function closedDaysBlock(lines: readonly ClosedDayLine[] | null | undefined): string[] {
  if (!lines || lines.length === 0) return [];
  return ["", CLOSED_DAYS_HEADING, ...lines.map((l) => l.line)];
}
