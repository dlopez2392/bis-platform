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
 *    convention) is safe everywhere this value is used: a bare backslash
 *    carries no meaning in PostgREST's unquoted-operand grammar (only `,`
 *    and `(`/`)` do), so `\_` reaches Postgres's LIKE engine exactly as
 *    typed and is read there as a literal underscore, not "any one
 *    character" — true whether the caller interpolates raw or quotes.
 *
 * The length cap runs on the RAW value, before escaping can lengthen it —
 * capping the escaped form instead could truncate mid-escape and hand
 * Postgres a pattern ending in a lone, dangling `\`, which LIKE rejects
 * outright. Keeps a pathological paste from becoming a pathological query.
 *
 * Callers must treat `""` as "no searchable term" and skip the query entirely.
 */
const MAX_TERM_LENGTH = 80;

export function sanitizeSearchTerm(value: string): string {
  const base = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM_LENGTH)
    .replace(/[\\%"(),*]/g, "");
  return base.replace(/_/g, "\\_");
}
