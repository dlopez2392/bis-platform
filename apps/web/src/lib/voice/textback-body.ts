import { m } from "@/lib/messages";

/**
 * What a missed caller receives when the operator has not written their own.
 *
 * `brandName` is the CUSTOMER-FACING company name — `brandDisplayName`
 * (email/templates/shell.ts), i.e. `brand_name` falling back to
 * `accounts.name`. Never `accounts.name` on its own: that is the agency's
 * internal label for the company ("Rio Roofing — trial"), and this text goes
 * to the client's customer, signed. It is also the same trap that put the
 * internal label on the email From line before M4d, and here it costs money
 * as well as face — the em dash such labels carry is outside GSM-7, so the
 * whole message silently becomes two segments.
 *
 * One SMS segment in GSM-7 when the company name stays inside the GSM-7
 * character set (GSM7_BASE, segments.ts). That is NOT true for every
 * plausible company name: this is a Rio Grande Valley platform with heavily
 * Hispanic client names, and a name carrying a character outside that set —
 * an accented vowel is the common case here — silently flips the WHOLE
 * message to UCS-2 at 70 characters per segment, and this message is long
 * enough that the flip costs two. `defaultTextbackBody("García Roofing")` is
 * exactly that case: ucs2, 84 chars, 2 segments (pinned in
 * textback-body.test.ts). That is why the settings counter
 * (voice-settings.tsx) renders the real segmentsFor() count for this actual
 * string instead of assuming one — the cost stays visible instead of
 * silently doubling the bill for exactly the clients most likely to hit it.
 *
 * Plain language a business owner would text, no template syntax. It names
 * the company on purpose — the same trait that can force the second
 * segment — because a text from an unknown number is otherwise
 * indistinguishable from spam. An operator who wants a guaranteed
 * single-segment message can always write their own.
 *
 * The brief's copy used an em dash ("—") here; that character is also
 * outside GSM7_BASE and would have forced UCS-2 for every company name, not
 * just accented ones — caught by running the brief's own test
 * (task-5-brief.md), not by inspection. Swapped for a comma, which reads at
 * least as plain and stays in the GSM-7 set.
 *
 * Blank/whitespace-only account name: this is the ONLY definition of the
 * text-back default, so a future caller (the SMS sender, not just this
 * settings page) inherits the fallback for free instead of needing its own
 * copy of it — the bug this module was written to make impossible. There is
 * no placeholder noun ("our team") here on purpose: a text signed by an
 * invented company name reads like a machine wrote it, and it is worse than
 * not naming one. Instead the identifying clause is dropped entirely and the
 * message opens on the apology sentence alone — that sentence already reads
 * correctly standalone, so nothing else changes. Copy lives in messages.ts
 * per this repo's client-facing-copy rule, the same precedent
 * `setup.number.unknownAccount` sets for a missing name elsewhere.
 *
 * `language` is the language the CALLER actually spoke, from
 * `detectSpokenLanguage` — the same value the call row stores, so the text a
 * caller gets and the language the operator sees on the call can never
 * disagree. This platform serves the Rio Grande Valley and voice profiles
 * carry `languages: "en" | "es" | "both"`; answering a Spanish caller in
 * English was a defect, not a simplification. Only the DEFAULT is chosen this
 * way: an operator who has written their own `textback_body` gets it sent
 * exactly as written, never translated.
 *
 * The Spanish copy is written with no á/í/ó/ú on purpose. Those four are
 * outside GSM7_BASE (é, ñ, ü, ¿ and ¡ are inside it), and a single one drops
 * the whole message to UCS-2 at 70 characters per segment — which the
 * sentence does not fit in. The natural first draft, "responda aquí y le
 * ayudamos", measured ucs2/86 chars/2 segments for a plain GSM-7 company
 * name: two segments for every Spanish caller, forever. "responda este
 * mensaje" says the same thing in one. Measured, not assumed — pinned in
 * textback-body.test.ts.
 */
export function defaultTextbackBody(brandName: string, language: "en" | "es"): string {
  if (!brandName.trim()) {
    return language === "es"
      ? m["voice.textback.defaultBodyNoNameEs"]
      : m["voice.textback.defaultBodyNoNameEn"];
  }
  const template = language === "es"
    ? m["voice.textback.defaultBodyEs"]
    : m["voice.textback.defaultBodyEn"];
  // Function replacement, not a plain string: a company name containing `$&`
  // or `$'` would otherwise be re-interpreted by String.replace as a
  // substitution pattern and mangle the message.
  return template.replace("{name}", () => brandName);
}
