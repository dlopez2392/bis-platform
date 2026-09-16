// The one escaper every TeXML document in this directory is built with.
//
// It lived inside `route.ts` as a module-private function until 2026-09-16,
// with its own comment ending "if a third site ever needs one, promote
// `xmlText` into a module both directories import rather than copying either
// again" (`handoff-result/route.ts`). The third site arrived: the handoff
// route interpolates an action URL, a caller id and a dialled number into a
// document, and it was doing all three raw.
//
// This file is NOT a route. Next.js only treats `route.ts`/`page.tsx` as
// routable, so a helper colocated beside them is ordinary — and colocated is
// where it belongs, because it exists for exactly the documents this
// directory emits and for nothing else.

/**
 * Turns a VALUE into XML text. Everything the TeXML routes interpolate into a
 * document — a URI, an action URL, a phone number — goes through here, and
 * the reason is one character.
 *
 * The SIP URI is CHARACTER DATA inside `<Sip>`, and a URI's own parameter
 * separator is `&`, which in XML 1.0 §2.4 begins an entity reference: a
 * strict parser reads `&X-BIS-Handoff` and reports a fatal error, a lenient
 * one silently drops the token. The bridge carried one URI parameter and no
 * separator until the handoff feature added a second, so the day that second
 * parameter appeared, every inbound call emitted a document that is not XML.
 * Nothing caught it: the whole suite asserted that a token was PRESENT, never
 * that the document parses. `wellformed.test.ts` now parses every document
 * this app emits, which is what makes the NEXT parameter safe.
 *
 * Escaping here rather than at the join keeps the URI a URI right up to the
 * moment it becomes XML — the same reason `encodeURIComponent` is applied to
 * the values and not to the whole string.
 *
 * FIVE ENTITIES, not three, and the extra two are the reason this is the
 * function the routes share. `"` and `'` are only special inside an ATTRIBUTE
 * VALUE — and every caller here has at least one attribute site
 * (`action="…"`, `callerId="…"`), where a quote ends the attribute early and
 * the rest of the URL becomes garbage element syntax. The rule, stated once:
 * TEXT needs three, ANYTHING THAT CAN LAND IN AN ATTRIBUTE needs five, so a
 * shared escaper takes five. `escapeXmlText` in `handoff-result/route.ts`
 * deliberately keeps three because its single caller is character data
 * between `<Say>` and `</Say>` and can never be anything else.
 */
export function xmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
