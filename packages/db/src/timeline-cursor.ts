/**
 * Server paging for the record page's timeline (S-03 part 1, 1b; spec C3). Seven tables merge into
 * one list ordered (at desc, id desc); each source reads `limit` rows strictly past the cursor with
 * the contact list's row-value idiom (contacts.ts, listContacts), and record.ts merges them. `v` is
 * the last row's own timestamp exactly as PostgREST returned it, never reformatted.
 */
export type TimelineCursor = { v: string; id: string };
export type TimelinePageOpts = { before?: TimelineCursor; limit: number };
export const TIMELINE_PAGE_SIZE = 30;

// PostgREST serialises timestamptz as ISO 8601 with T and an offset, up to six fractional digits.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTimelineInstant(v: string): boolean {
  return INSTANT.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * A string that sorts like the instant, to the microsecond. `Date` keeps milliseconds only, so two
 * rows 1 µs apart (or a cursor row and its neighbour) would tie; the fraction is read from the text
 * (booking.ts's `sameMicroInstant` reads it the same way).
 */
export function instantKey(at: string): string {
  const m = INSTANT.exec(at);
  const whole = m ? Date.parse(at.replace(/\.\d+/, "")) : Number.NaN;
  if (!m || Number.isNaN(whole)) throw new TypeError(`instantKey: not a timestamp: ${JSON.stringify(at)}`);
  return `${String(whole / 1000).padStart(12, "0")}.${(m[1] ?? "").padEnd(6, "0")}`;
}

/** `column < v OR (column = v AND id < id)`, for PostgREST's `.or()`. Validated, then quoted, so a
 *  hand-edited `?before=` can never reach the filter grammar (apps/web validates it first too). */
export function timelineBeforeFilter(column: string, before: TimelineCursor): string {
  if (!isTimelineInstant(before.v) || !UUID.test(before.id)) throw new TypeError("timeline cursor: malformed");
  const v = `"${before.v}"`;
  return `${column}.lt.${v},and(${column}.eq.${v},id.lt.${before.id.toLowerCase()})`;
}

type Chain = {
  order: (column: string, o: { ascending: boolean }) => Chain;
  or: (filter: string) => Chain;
  limit: (n: number) => Chain;
};

/** Applies the page to a PostgREST query: (column desc, id desc), past the cursor, at most `limit`. */
export function withTimelinePage<T>(q: T, column: string, page: TimelinePageOpts): T {
  let c = (q as unknown as Chain).order(column, { ascending: false }).order("id", { ascending: false });
  if (page.before) c = c.or(timelineBeforeFilter(column, page.before));
  return c.limit(page.limit) as unknown as T;
}
