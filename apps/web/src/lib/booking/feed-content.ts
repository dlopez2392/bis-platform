import type { Locale } from "@/lib/i18n/locale";
import { isPlaceholderName } from "@/lib/voice/tools/placeholders";
import { bookingUid, calendarFeedIcs, type FeedEvent } from "./ics";
import { feedStrings } from "./feed-strings";

/**
 * F-048 part 2: bookings → the owner's feed. Pure; `calendar-feed.ts` does every read. A customer is a
 * FIRST NAME only (spec 4.3): never a last name, phone, email, note, meeting link (D3) or address.
 */
export type FeedContentRow = {
  id: string; status: "booked" | "completed" | "no_show";
  starts_at: string; ends_at: string; updated_at: string; created_at: string;
  first_name: string | null;
  /** `rescheduleRoots`' answer for this row. */
  rootId: string; depth: number;
};
export type MeetingKind = "in_person" | "phone" | "video";
export type FeedOptions = { locale: Locale; meetingType: MeetingKind; origin: string | null; accountId: string };

const NAME_MAX = 40;

export function feedFirstName(raw: string | null, locale: Locale): string {
  const whole = (raw ?? "").trim();
  const word = whole.split(/\s+/)[0] ?? "";
  if (!word || /[0-9@]/.test(word) || isPlaceholderName(whole) || isPlaceholderName(word)) return feedStrings(locale).customer;
  return Array.from(word).slice(0, NAME_MAX).join("");
}

const deeper = (a: FeedContentRow, b: FeedContentRow) => (a.depth !== b.depth ? a.depth > b.depth : a.created_at > b.created_at);

export function feedEvents(rows: readonly FeedContentRow[], o: FeedOptions): FeedEvent[] {
  const s = feedStrings(o.locale);
  const kind = s[`kind_${o.meetingType}`];
  const description = o.origin
    ? s.openIn.replace("{url}", () => `${o.origin}/dashboard/accounts/${o.accountId}/calendar`)
    : undefined;
  const byUid = new Map<string, { row: FeedContentRow; event: FeedEvent }>();
  for (const row of rows) {
    const name = feedFirstName(row.first_name, o.locale);
    const base = s.summary.replace("{kind}", () => kind).replace("{name}", () => name);
    const event: FeedEvent = {
      uid: bookingUid(row.rootId), sequence: row.depth,
      startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at), stampedAt: new Date(row.updated_at),
      summary: row.status === "no_show" ? `${s.noShow} · ${base}` : base,
      ...(description ? { description } : {}),
    };
    const prior = byUid.get(event.uid);
    if (prior) {
      const keep = deeper(row, prior.row) ? row : prior.row;
      console.error(`calendar feed: two live rows for one appointment (${prior.row.id}, ${row.id}); kept ${keep.id}`);
      if (keep === prior.row) continue;
    }
    byUid.set(event.uid, { row, event });
  }
  return [...byUid.values()].map((v) => v.event).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function feedIcsFor(o: FeedOptions & { brandName: string; rows: readonly FeedContentRow[] }): string {
  const s = feedStrings(o.locale);
  const name = o.brandName ? s.calendarName.replace("{business}", () => o.brandName) : s.calendarNameNoBrand;
  return calendarFeedIcs({ name, events: feedEvents(o.rows, o) });
}
