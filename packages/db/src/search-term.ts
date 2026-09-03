/**
 * The one sanitizer for every user-typed search term in this package.
 *
 * Two different dangers, both real, both documented by contacts.ts:23-49:
 *
 * 1. PostgREST's FILTER GRAMMAR. Multi-column searches are expressed as an
 *    interpolated `.or("a.ilike.%x%,b.ilike.%x%")` string. A `"`, `,`, `(` or
 *    `)` in the operand terminates it early — and the incident that comment
 *    records is that a filter which fails to parse came back as "no match"
 *    rather than an error, so the breakage was invisible.
 * 2. ILIKE WILDCARDS. `%` and `_` are pattern metacharacters, `\` escapes
 *    them, and PostgREST additionally accepts `*` as an alias for `%`. Left
 *    in, a typed `%` quietly turns a search into "match everything".
 *
 * Both are handled by REMOVAL rather than escaping. Escaping would have to be
 * correct in two different grammars at once; for a fuzzy find-as-you-type box
 * dropping the character is both safer and what the user means. The length cap
 * keeps a pathological paste from becoming a pathological query.
 *
 * Callers must treat `""` as "no searchable term" and skip the query entirely.
 */
const MAX_TERM_LENGTH = 80;

export function sanitizeSearchTerm(value: string): string {
  return value
    .replace(/[\\%_"(),*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM_LENGTH);
}
