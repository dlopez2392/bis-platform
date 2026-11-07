/**
 * A thrown value as a log line may carry it. Moved here from
 * lib/billing/billing-link.ts (which re-exports it) so code outside billing,
 * the SMS send gate first, logs through the same redaction.
 */
/** Anything shaped like an email address. Generous on purpose: a false
 *  match costs a word in a log line, a miss puts a person's address there. */
const EMAIL_LIKE = /[^\s<>()[\]{},;:"'`]+@[^\s<>()[\]{},;:"'`]+/g;

/** A phone number, in the shapes a carrier or SMS error quotes one. NARROW on
 *  purpose, unlike EMAIL_LIKE: a log line lives on its numbers (statuses,
 *  carrier codes, ids, epochs, timestamps), so a bare run of digits is never
 *  taken. Two shapes only:
 *  - E.164: "+" (or URL-encoded "%2B") then 8 to 15 digits, nothing glued on;
 *  - North American: (555) 123-4567, 555-123-4567, 555.123.4567,
 *    555 123 4567 (one separator used throughout), optionally after +1 or 1,
 *    not inside a longer hyphenated or dotted run (a uuid, an IP). */
const PHONE_LIKE = new RegExp(
  [
    String.raw`(?:\+|%2[bB])\d{8,15}(?!\d)`,
    String.raw`(?<![\w+%-])(?<!\d\.)(?:\+?1[ .-]?)?(?:\(\d{3}\) ?\d{3}[ .-]|\d{3}([ .-])\d{3}\1)\d{4}(?![\w-])(?!\.\d)`,
  ].join("|"),
  "g",
);

/**
 * An error as a log line may carry it: its class (the SDK's `.type`, else its
 * name), Stripe's `code` and HTTP status when present, and its message with
 * every email address replaced by "[email]" and every phone number by
 * "[phone]", cut to 300 characters. Stripe's and the mail provider's messages
 * can quote the recipient ("Invalid email address: …", "550 <…>: recipient
 * rejected"), the carrier's can quote the customer's number, and a log is no
 * place for either (review correction 4).
 */
export function loggableError(e: unknown): string {
  const o = typeof e === "object" && e !== null
    ? (e as { type?: unknown; name?: unknown; code?: unknown; statusCode?: unknown; message?: unknown })
    : {};
  const kind = typeof o.type === "string" ? o.type : typeof o.name === "string" ? o.name : typeof e;
  const code = typeof o.code === "string" ? ` code=${o.code}` : "";
  const status = typeof o.statusCode === "number" ? ` status=${o.statusCode}` : "";
  const raw = typeof o.message === "string" ? o.message : String(e);
  return `${kind}${code}${status}: ${raw.replace(EMAIL_LIKE, "[email]").replace(PHONE_LIKE, "[phone]").slice(0, 300)}`;
}
