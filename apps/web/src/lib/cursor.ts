//
// One cursor idiom for every paged list. `calls` had this logic private in its
// own page.tsx; contacts needs the same parsing plus an id tiebreaker, and two
// copies of a rule about a hand-editable URL parameter is one copy too many.
//
// Both parsers are TOTAL: `?before=` is user-editable, so anything unparseable
// must read as "no cursor" (cold start), never as an exception on a page a
// user can navigate to.
//
const TS = /^\d{4}-\d{2}-\d{2}T/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `parseTimeCursor`-only now (see its own comment below) — `parseCursor` no
// longer checks `v`'s shape at all, only its type.
const isTs = (v: string) => TS.test(v) && !Number.isNaN(Date.parse(v));

/**
 * A row's position in a paged, possibly-sorted list. `v` is whatever the
 * CURRENT sort column holds on the last row shown — a timestamp for the
 * default created-at order, or (Task 3b) a name or a company — and `id` is
 * the tiebreaker that makes the ordering total. `v` is `null` exactly when
 * the last row's sort column was itself null (`sort_name`/`company_name`
 * are nullable; see packages/db/src/contacts.ts's null-ordering rules).
 *
 * OPAQUE ON PURPOSE, unlike the timestamp-only cursor this replaced: a sort
 * value can now be free text, so there is no single format left to validate
 * the way the old `isTs` check validated a timestamp. `parseCursor` below
 * therefore checks only SHAPE (a string-or-null paired with a real uuid),
 * never content — the consumer (`listContacts`) must treat `v` as
 * attacker-controlled text when building a query from it, exactly the
 * caution this package's own search path already applies to a typed term.
 */
export type RowCursor = { v: string | null; id: string };

/**
 * base64url of the JSON pair `[v, id]` — never `|`-joined, which was safe
 * only while `v` was always a timestamp. A sort value can be a name or a
 * company, either of which can contain a literal `|`; and even before that,
 * a raw `+` surviving into a query string decodes to a SPACE (the reason
 * every caller has always had to build the query string with
 * `URLSearchParams` rather than concatenation). Both hazards disappear once
 * the pair travels as base64url rather than as characters meaningful to a
 * query string or to this module's own old separator. `v` is never
 * reformatted going in or out — round-tripped exactly as the row held it.
 */
export function encodeCursor(c: RowCursor): string {
  return Buffer.from(JSON.stringify([c.v, c.id]), "utf8").toString("base64url");
}

/**
 * CALLERS MUST STILL BUILD THE QUERY STRING WITH `URLSearchParams`, never by
 * concatenation — the encoded value is base64url, so it is itself safe
 * unencoded in a query string, but this is the one habit that keeps working
 * no matter what a future cursor shape adds.
 */
export function parseCursor(raw: string | undefined): RowCursor | undefined {
  // Next.js types a searchParams value as `string | string[] | undefined`,
  // and a duplicated query key (`?before=A&before=B`) produces an ARRAY at
  // runtime whatever the page's own annotation says. `Array.prototype.split`
  // does not exist, so without this guard a hand-editable URL can throw a
  // TypeError instead of reading as a cold start.
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [v, id] = parsed as [unknown, unknown];
    if (typeof id !== "string" || !UUID.test(id)) return undefined;
    if (v !== null && typeof v !== "string") return undefined;
    return { v, id };
  } catch {
    return undefined;
  }
}

/**
 * The timestamp-only form `calls` already ships — byte-for-byte the same
 * rule as the `cursorFrom` it replaces, so calls' behaviour is unchanged.
 * UNTOUCHED by Task 3b on purpose: `calls` pages by created_at alone and
 * never needed an id tiebreaker or a sort column, so it keeps its own
 * simpler, content-VALIDATED cursor rather than adopting the opaque
 * `RowCursor` above.
 *
 * VALIDATED, NEVER REWRITTEN. The timestamp goes back into a PostgREST `lt`
 * filter exactly as it arrived. Postgres serialises timestamptz with
 * microseconds and an offset ("2026-09-03T17:17:48.364157+00:00"), so a regex
 * that insists on `.SSSZ` rejects every real cursor, and re-serialising
 * through `Date` truncates to milliseconds — which can silently skip a row
 * sharing the boundary microsecond. This is the rule calls/page.tsx already
 * documented; it is preserved here rather than tightened.
 */
export function parseTimeCursor(raw: string | undefined): string | undefined {
  // Same array-at-runtime hazard as `parseCursor` above. Previously this
  // survived an array input only by accident — `TS.test` coerces its
  // argument via `String(v)` — which is a real asymmetry with `parseCursor`
  // throwing on the same input. Explicit guard, no behaviour change for any
  // string input.
  if (typeof raw !== "string") return undefined;
  if (!raw || !isTs(raw)) return undefined;
  return raw;
}
