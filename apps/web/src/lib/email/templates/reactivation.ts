import { reactivationFooterReason } from "@/lib/automations/reactivation-copy";
import { shell, escapeHtml, type EmailBrand } from "./shell";

export type ReactivationEmailInput = {
  brand: EmailBrand;
  /** Composed by the caller with `reactivationSubject(row.brandName)`, never
   *  interpolated here: `brand.name` is `""` for an account with no brand
   *  name, and `A note from ${brand.name}` would then ship a subject ending
   *  in "from ". */
  subject: string;
  /** Already defaulted by the caller (the pass). Blank lines are paragraph
   *  breaks, as in the follow-up template. */
  body: string;
  /** The business's postal address (`accounts.mailing_address`, 0048), as
   *  stored — possibly several lines, possibly CRLF from a browser textarea.
   *  REQUIRED: the pass skips a row whose address is blank rather than send
   *  without one, so this template never has to decide what an address-less
   *  footer would say. */
  mailingAddress: string;
};

/** Muted and small, the shell's dialect: inline style, grey, a top margin. */
const FOOTER_STYLE = "margin:16px 0 0;font-size:13px;color:#71717a;";

/**
 * The check-in to a past customer. The FOLLOW-UP's restraint, not the review
 * request's: no button, because the action is "reply to this email", and a
 * button would need somewhere to point. A short personal note from a business
 * they know, not a campaign.
 *
 * AND A FOOTER (decision A, danlo, 2026-09-22), which the follow-up does not
 * carry: this is the one recipe that emails someone who did not just
 * interact with the business, and its purpose is winning work back —
 * commercial email, which under CAN-SPAM (the orchestrator's reading, not a
 * lawyer's) needs a working opt-out and the sender's physical postal
 * address. The opt-out is a REPLY, not a link, so the no-link restraint
 * above survives it: the pass also refuses to send without a reply-to, so a
 * reply reaches the business and not the agency's `EMAIL_FROM` mailbox.
 */
export function reactivationEmail(input: ReactivationEmailInput):
  { subject: string; html: string; text: string } {
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const reason = reactivationFooterReason(input.brand.name);
  // One line per address line, CRLF or LF, blank lines and edge whitespace
  // dropped — the same lines in both parts, joined differently.
  const addressLines = input.mailingAddress
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const html = shell(
    input.brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join("")
      + `<p style="${FOOTER_STYLE}">${escapeHtml(reason)}</p>`
      + `<p style="${FOOTER_STYLE}">${addressLines.map(escapeHtml).join("<br>")}</p>`,
  );
  return {
    subject: input.subject,
    html,
    text: [...paragraphs, reason, addressLines.join("\n")].join("\n\n"),
  };
}
