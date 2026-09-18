/**
 * What a reader actually receives from `renderToStaticMarkup` — tags
 * stripped, HTML entities decoded.
 *
 * THE TRAP THIS EXISTS TO CLOSE, which this repo has now hit twice. React
 * escapes an apostrophe to `&#x27;` in static markup, so asserting
 * `expect(html).toContain(m["zone.guessed.agency"])` — a string containing
 * "the agency's" — matches NOTHING, however correctly the component renders.
 * The positive form fails loudly and is easy to spot. The NEGATIVE form is
 * the dangerous one: `expect(html).not.toContain(…)` on a string with an
 * apostrophe can never fail, so it reads as coverage and is worth nothing —
 * the "assertion satisfied by something adjacent" shape that has produced
 * every vacuous test this repo has had to delete.
 *
 * It lives here, shared, rather than as a local helper in each spec
 * precisely because the first fix WAS a local helper: `zone-note.test.ts`
 * carried one and documented the trap, and the sibling spec written the same
 * hour hit the identical bug anyway. A trap that has to be remembered per
 * file will be forgotten per file.
 *
 * Not a general-purpose HTML parser and should not become one: it decodes
 * the entities React actually emits for text content, which is the whole
 * surface a copy assertion touches.
 */
export function renderedText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Ampersand LAST: decoding it first would let "&amp;#x27;" collapse into
    // a real apostrophe through two passes.
    .replace(/&amp;/g, "&");
}
