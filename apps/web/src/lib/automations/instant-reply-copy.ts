import { m } from "@/lib/messages";

/**
 * What a new web-form lead receives when the operator has not written their
 * own text — the PREFILL on the settings card, and nothing else. The send
 * path (instant-reply.ts) sends the SAVED text verbatim; this function never
 * runs at send time, which is what makes the instant reply the one recipe
 * that cannot leak a name in its send path at all.
 *
 * `brandName` is the CUSTOMER-FACING name (brandDisplayName, page.tsx). A
 * blank one drops the opening clause instead of inventing "our team" — the
 * text-back's rule (voice/textback-body.ts), for the same reason: a text
 * signed by an invented company reads like a machine wrote it.
 *
 * `language` is the form's locale — the language the PERSON filled the form
 * in, the receipt email's own signal — so the text and the email a lead gets
 * in the same minute speak the same language. Both defaults are ONE GSM-7
 * segment for a GSM-7 company name and two for an accented one, measured
 * (not assumed) in instant-reply-copy.test.ts. What is SENT also carries the
 * opt-out sentence (`withOptOut`, 23 septets in English, 29 in Spanish), and
 * with it the Spanish default stays one segment for a name of up to 36
 * characters, the English up to 32; an accented name is three either way.
 *
 * Function replacement, not a plain string: a company name containing `$&`
 * or `$'` would otherwise be re-interpreted by String.replace.
 */
export function defaultInstantReplyBody(brandName: string, language: "en" | "es"): string {
  if (!brandName.trim()) {
    return language === "es"
      ? m["automations.instantReply.defaultBodyNoNameEs"]
      : m["automations.instantReply.defaultBodyNoNameEn"];
  }
  const template = language === "es"
    ? m["automations.instantReply.defaultBodyEs"]
    : m["automations.instantReply.defaultBodyEn"];
  return template.replace("{name}", () => brandName);
}
