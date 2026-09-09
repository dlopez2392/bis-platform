//
// One cursor idiom for every paged list. `calls` had this logic private in its
// own page.tsx; contacts needs the same parsing plus an id tiebreaker, and two
// copies of a rule about a hand-editable URL parameter is one copy too many.
//
// Both parsers are TOTAL: `?before=` is user-editable, so anything unparseable
// must read as "no cursor" (cold start), never as an exception on a page a
// user can navigate to.
//
// VALIDATED, NEVER REWRITTEN. The timestamp goes back into a PostgREST `lt`
// filter exactly as it arrived. Postgres serialises timestamptz with
// microseconds and an offset ("2026-09-03T17:17:48.364157+00:00"), so a regex
// that insists on `.SSSZ` rejects every real cursor, and re-serialising
// through `Date` truncates to milliseconds — which can silently skip a row
// sharing the boundary microsecond. This is the rule calls/page.tsx already
// documented; it is preserved here rather than tightened.
const TS = /^\d{4}-\d{2}-\d{2}T/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isTs = (v: string) => TS.test(v) && !Number.isNaN(Date.parse(v));

/** A row's position in a `created_at desc, id desc` ordering. */
export type RowCursor = { at: string; id: string };

/**
 * CALLERS MUST BUILD THE QUERY STRING WITH `URLSearchParams`, never by
 * concatenation. A Postgres timestamp ends in `+00:00`, and a raw `+` in a
 * query string decodes to a SPACE — the cursor then fails `Date.parse` and
 * silently reads as a cold start, sending the user back to page one forever.
 * `URLSearchParams` percent-encodes it correctly.
 */
export function encodeCursor(c: RowCursor): string {
  return `${c.at}|${c.id}`;
}

export function parseCursor(raw: string | undefined): RowCursor | undefined {
  if (!raw) return undefined;
  const parts = raw.split("|");
  if (parts.length !== 2) return undefined;
  const [at, id] = parts as [string, string];
  if (!isTs(at) || !UUID.test(id)) return undefined;
  return { at, id };
}

/** The timestamp-only form `calls` already ships — byte-for-byte the same
 *  rule as the `cursorFrom` it replaces, so calls' behaviour is unchanged. */
export function parseTimeCursor(raw: string | undefined): string | undefined {
  if (!raw || !isTs(raw)) return undefined;
  return raw;
}
