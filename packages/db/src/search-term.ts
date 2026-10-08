/**
 * The one sanitizer for every user-typed search term in this package.
 *
 * Two different dangers, both real, both documented by contacts.ts:23-49:
 *
 * 1. PostgREST's FILTER GRAMMAR. Multi-column searches are expressed as an
 *    interpolated `.or("a.ilike.%x%,b.ilike.%x%")` string. A `"`, `,`, `(` or
 *    `)` in the operand terminates it early — and the incident that comment
 *    records is that a filter which fails to parse came back as "no match"
 *    rather than an error, so the breakage was invisible. STILL handled by
 *    removal: making these four safe needs the whole operand double-quoted
 *    (`contacts.ts`'s own `quoteFilterValue`), and this function is shared by
 *    every raw-interpolated `.or()` builder in the package (`searchCalls` in
 *    voice.ts, not owned by this agent) — changing what reaches an UNQUOTED
 *    operand here would reopen exactly this bug there. D-009's own "(956)
 *    555-0199 never matches" is fixed differently, in `contacts.ts`'s
 *    `withSearch`: digits extracted from the RAW term matched against
 *    `phone_key`, so formatting survives without this function ever having
 *    to let `(`, `)` or `,` through.
 * 2. ILIKE WILDCARDS. `%` and `_` are pattern metacharacters, `\` escapes
 *    them, and PostgREST additionally accepts `*` as an alias for `%`. Left
 *    in, a typed `%` quietly turns a search into "match everything". `%`,
 *    `*` and a literal `\` stay removed (same reasoning as the grammar class
 *    above — `*`'s PostgREST-level substitution and any backslash collision
 *    are untested in the OTHER package's unquoted `.or()` builder, and this
 *    function cannot verify that call site). `_` is the one D-009 names as
 *    broken: deleting it turned "john_doe" into "johndoe", which the search
 *    never matched (there IS a character between "john" and "doe" in the
 *    stored name) — exactly backwards from "find it regardless of a stray
 *    character in the box". ESCAPING it (`\_`, ILIKE's own default escape
 *    convention) is safe for an UNQUOTED operand (a bare backslash carries
 *    no meaning in PostgREST's unquoted grammar), so `\_` reaches Postgres's
 *    LIKE engine exactly as typed and is read there as a literal underscore.
 *
 *    REVIEW CORRECTION — this is NOT also safe for a QUOTED operand, and an
 *    earlier version of this comment claimed it was. PostgREST's own quoted-
 *    value grammar treats a backslash as a generic escape introducer for
 *    whatever follows it (`\\` → `\`, `\"` → `"`, and the same rule for any
 *    OTHER character: `\_` → bare `_`) — quoting `john\_doe` (`contacts.ts`'s
 *    own `quoteFilterValue`) strips the backslash before Postgres ever sees
 *    the pattern, leaving a bare `_` that matches "johnXdoe" too. Every
 *    caller of this function MUST interpolate the result UNQUOTED (as
 *    `contacts.ts`'s `withSearch` and `voice.ts`'s `searchCalls` both already
 *    do) for the escape to survive.
 *
 * The length cap runs on the RAW value, before either removal or escaping
 * can change its length — capping afterward could truncate mid-escape and
 * hand Postgres a pattern ending in a lone, dangling `\`, which LIKE rejects
 * outright. Keeps a pathological paste from becoming a pathological query.
 * Character removal runs BEFORE the whitespace collapse, not after: "a ( b"
 * with `(` simply deleted is "a  b" (the space on each side of it survives,
 * now doubled) — collapsing first would only re-single a run that was
 * already single, and leave the real double space behind.
 *
 * Callers must treat `""` as "no searchable term" and skip the query entirely.
 */
const MAX_TERM_LENGTH = 80;

function sanitizedBase(value: string): string {
  return value
    .slice(0, MAX_TERM_LENGTH)
    .replace(/[\\%"(),*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How many characters of REAL, user-typed content `value` carries — the
 * floor every "is this query long enough to bother searching" caller
 * (the ⌘K palette, this route's own MIN_QUERY) must measure, instead of
 * `sanitizeSearchTerm(value).length`. A lone "_" sanitizes to "\_" — TWO
 * characters — which would clear a 2-character floor measured on the
 * escaped form even though the box holds exactly one real character.
 */
export function searchTermLength(value: string): number {
  return sanitizedBase(value).length;
}

export function sanitizeSearchTerm(value: string): string {
  return sanitizedBase(value).replace(/_/g, "\\_");
}
