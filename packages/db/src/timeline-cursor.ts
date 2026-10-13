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
// Numbered groups double as the field-level check below (apps/web's tsconfig targets ES2017, which
// cannot type a named group's `.groups`, and this file is typechecked through that config too, since
// web imports db as source rather than a built package): `Date.parse` rolls "2026-02-30" over to
// Mar 2 rather than refusing it, and tolerates an offset past Postgres's own +/-15:59 and year 0000
// (bis-ci `pg_input_is_valid`: +16:00 false, +15:59 true, 0000-01-01 false), so isTimelineInstant
// checks the fields itself instead of trusting Date.parse alone — the same rule
// apps/web/src/lib/cursor.ts's isRealInstant applies; duplicated rather than imported, since db
// cannot depend on web. Groups: 1 y, 2 mo, 3 d, 4 h, 5 mi, 6 s, 7 frac (optional), 8 offset-hh and
// 9 offset-mm (both present together, or both absent for "Z").
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|[+-](\d{2}):(\d{2}))$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTimelineInstant(v: string): boolean {
  const m = INSTANT.exec(v);
  if (!m || Number.isNaN(Date.parse(v))) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]), s = Number(m[6]);
  // Date.UTC maps years 0-99 to 1900-1999; from year 1 on, that keeps the leap-year pattern.
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const offsetOk = m[8] === undefined || (Number(m[8]) <= 15 && Number(m[9]) <= 59);
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth && h <= 23 && mi <= 59 && s <= 59 && offsetOk;
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
  return `${String(whole / 1000).padStart(12, "0")}.${(m[7] ?? "").padEnd(6, "0")}`;
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

type Filterable = { eq: (column: string, value: string) => Filterable; in: (column: string, values: string[]) => Filterable };

/**
 * S-03 part 2 (C6): one source function serves one person (the contact page, `.eq`, unchanged) or a
 * household's members (`.in`). An empty set is refused: PostgREST's `in.()` is not a query anyone
 * means, and the merged page short-circuits before it (record.ts).
 */
export function forContacts<T>(q: T, column: string, ids: string | readonly string[]): T {
  if (typeof ids === "string") return (q as unknown as Filterable).eq(column, ids) as unknown as T;
  if (ids.length === 0) throw new TypeError("forContacts: an empty set");
  return (q as unknown as Filterable).in(column, [...ids]) as unknown as T;
}

/** Applies the page to a PostgREST query: (column desc, id desc), past the cursor, at most `limit`. */
export function withTimelinePage<T>(q: T, column: string, page: TimelinePageOpts): T {
  let c = (q as unknown as Chain).order(column, { ascending: false }).order("id", { ascending: false });
  if (page.before) c = c.or(timelineBeforeFilter(column, page.before));
  return c.limit(page.limit) as unknown as T;
}
