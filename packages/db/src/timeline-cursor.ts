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

// ---------------------------------------------------------------------------------------------
// Timeline paging bug fix (packages/db server logic): two sources' own tables use a BIGINT id, not
// a uuid — `contact_archive_log` (0103) and `contact_merges` (0106) — so `timelineBeforeFilter`'s
// `id.lt.<uuid>` broke PostgREST ("invalid input syntax for type bigint: ...") on any page whose
// cursor came from a uuid-id source (every other source), and silently dropped those two sources'
// rows from the page (`listTimelinePage`'s `settle` swallows the error). `record-changes.ts`'s
// `encodeChangeCursorId`/`decodeChangeCursorId` already solved the identical shape problem for
// `record_changes`, independently (that file cannot be imported here without the dependency
// running the wrong way for this fix's scope); this is the same idea, generalised so BOTH of
// these sources can share it, and so `changes` could adopt it too once that source's own PR lands,
// by swapping its untagged codec for `encodeBigintCursorId("changes", ...)` below with its own tag.
// ---------------------------------------------------------------------------------------------

/** A timeline source whose own table id is a bigint, not a uuid. */
export type BigintCursorSource = "archive" | "merge";

/** Each source's fixed 8-hex-digit tag (its name's first four ASCII letters, hex-encoded), occupying
 *  the encoded id's FIRST group: `encodeBigintCursorId("archive", 1)` and `encodeBigintCursorId("merge", 1)`
 *  differ only here. `decodeBigintCursorId`'s round-trip re-encode is what turns that difference into
 *  "one source's encoded id never decodes as the other's": decoding with the WRONG source re-encodes
 *  the same trailing id digits under the wrong tag, which can never equal the original string (the
 *  tag itself is never separately re-checked — the round-trip already proves it matches, or it would
 *  not have matched at all). An untagged encoding (a plain bigint zero-padded straight into the full
 *  32-hex shape, `record-changes.ts`'s own idiom) always carries an all-zero first group, so it, too,
 *  fails that same round-trip the instant either of these tags is nonzero there instead. */
const BIGINT_CURSOR_TAG: Record<BigintCursorSource, string> = {
  archive: "61726368", // "arch"
  merge: "6d657267", // "merg"
};

/**
 * Embeds a real bigint id into the one UUID shape every reader of the merged timeline cursor
 * already requires (apps/web's `parseTimelineCursor`, this file's own `timelineBeforeFilter`).
 * `id` is always positive (both tables' ids are `generated always as identity`, starting at 1).
 */
export function encodeBigintCursorId(source: BigintCursorSource, id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError(`encodeBigintCursorId: id must be a safe positive integer, got ${id}`);
  }
  const tag = BIGINT_CURSOR_TAG[source];
  const hex = id.toString(16).padStart(24, "0");
  return `${tag}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 24)}`;
}

/**
 * The exact inverse, recognising ONLY a cursor id THIS function, for THIS source, could have
 * produced — `null` for anything else: a real random uuid, `record_changes`'s own untagged
 * encoding, or the other bigint source's own (correctly) tagged one. The single guard doing that
 * work is the round-trip re-encode on the last line: a candidate's first 8 hex digits are read as
 * if they were THIS source's own id digits (there is no separate tag check — one would only ever
 * be a faster-failing duplicate of what the re-encode already proves), so it can only succeed when
 * those digits happen to equal this source's own tag AND the remaining digits are this source's
 * own real id, both at once (`record-changes.ts`'s `decodeChangeCursorId` is the identical idiom,
 * one layer down, with no tag to re-check at all). Never trusted as proof a row exists by itself
 * (the same caution `record-changes.ts`'s `foldVia` doc comment already applies to a forged `via`);
 * the caller only ever uses a successful decode to build a stricter filter, never to skip a real read.
 */
export function decodeBigintCursorId(source: BigintCursorSource, v: string): number | null {
  const lower = v.toLowerCase();
  if (!UUID.test(lower)) return null;
  const hex = lower.replace(/-/g, "").slice(8);
  const n = parseInt(hex, 16);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return encodeBigintCursorId(source, n) === lower ? n : null;
}

/**
 * Applies a page to a bigint-id source (`contact_archive_log` 0103, `contact_merges` 0106):
 * `(column desc, id desc)`, past the cursor, at most `limit`. When the cursor's own id decodes as
 * THIS source's (the previous page's cutoff entry really was one of this source's own rows), the
 * exact `(column, id)` tie-break applies — `timelineBeforeFilter`'s own idiom, reached through the
 * codec instead of a raw uuid compare, with the real bigint id UNQUOTED (never the uuid source's
 * quoted, lower-cased string).
 *
 * Otherwise (the cutoff was a different source's row, or there is no cursor at all) this source
 * pages on time ALONE, and INCLUSIVELY (`column <= v`, never the strict `<` a uuid source's cursor
 * uses): the real tie for THIS source at that exact instant cannot be known from a foreign cursor,
 * and of the two ways to be wrong about it — skip a same-instant row of this source for good, or
 * show one that already appeared again on a later page — only the second is something a reader
 * could ever notice and shrug off; the first quietly erases an audit row (an archive or a merge)
 * with no sign anything is missing. This rule therefore never DROPS a row; it can, rarely, repeat one.
 */
export function withBigintTimelinePage<T>(q: T, column: string, source: BigintCursorSource, page: TimelinePageOpts): T {
  let c = (q as unknown as Chain).order(column, { ascending: false }).order("id", { ascending: false });
  if (page.before) {
    if (!isTimelineInstant(page.before.v)) throw new TypeError("timeline cursor: malformed");
    const v = `"${page.before.v}"`;
    const ownId = decodeBigintCursorId(source, page.before.id);
    c = c.or(ownId !== null ? `${column}.lt.${v},and(${column}.eq.${v},id.lt.${ownId})` : `${column}.lt.${v},${column}.eq.${v}`);
  }
  return c.limit(page.limit) as unknown as T;
}
