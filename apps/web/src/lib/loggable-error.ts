/**
 * A thrown value as a log line may carry it. Moved here from
 * lib/billing/billing-link.ts (which re-exports it) so code outside billing,
 * the SMS send gate first, logs through the same redaction.
 */
/** Anything shaped like an email address. Generous on purpose: a false
 *  match costs a word in a log line, a miss puts a person's address there. */
const EMAIL_LIKE = /[^\s<>()[\]{},;:"'`]+@[^\s<>()[\]{},;:"'`]+/g;

/**
 * An error as a log line may carry it: its class (the SDK's `.type`, else its
 * name), Stripe's `code` and HTTP status when present, and its message with
 * every email address replaced by "[email]", cut to 300 characters. Stripe's
 * and the mail provider's messages can quote the recipient ("Invalid email
 * address: …", "550 <…>: recipient rejected"), and a log is no place for a
 * client's address (review correction 4).
 */
export function loggableError(e: unknown): string {
  const o = typeof e === "object" && e !== null
    ? (e as { type?: unknown; name?: unknown; code?: unknown; statusCode?: unknown; message?: unknown })
    : {};
  const kind = typeof o.type === "string" ? o.type : typeof o.name === "string" ? o.name : typeof e;
  const code = typeof o.code === "string" ? ` code=${o.code}` : "";
  const status = typeof o.statusCode === "number" ? ` status=${o.statusCode}` : "";
  const raw = typeof o.message === "string" ? o.message : String(e);
  return `${kind}${code}${status}: ${raw.replace(EMAIL_LIKE, "[email]").slice(0, 300)}`;
}
