import { escapeHtml } from "./shell";

/** The footer's two inputs, shared by both marketing templates. */
export type MarketingFooterInput = {
  /** The business's postal address (`accounts.mailing_address`, 0048), as
   *  stored — possibly several lines, possibly CRLF from a browser textarea.
   *  REQUIRED: each pass skips a row whose address is blank rather than send
   *  without one, so no template ever decides what an address-less footer
   *  would say. */
  mailingAddress: string;
  /** Why they are getting this and how to stop it — composed by the caller
   *  with `marketingFooterReason(row.brandName)`, so the blank-brand branch
   *  lives in the copy module, never here. Plain text; this helper escapes it. */
  footerReason: string;
};

/** Muted and small, the shell's dialect: inline style, grey, a top margin. */
const FOOTER_STYLE = "margin:16px 0 0;font-size:13px;color:#71717a;";

/**
 * ONE FOOTER, TWO EMAILS (B21, danlo, 2026-09-23). The check-in
 * (`reactivation.ts`, decision A) and the referral ask (`referral-ask.ts`)
 * are the two MARKETING emails, and under CAN-SPAM (the orchestrator's
 * reading, not a lawyer's) each needs a working opt-out and the sender's
 * physical postal address. The opt-out is a REPLY, not a link, so neither
 * template's no-link restraint is broken by it.
 *
 * Returns the two parts separately because the templates join them
 * differently: `html` goes after the body paragraphs inside the shell, and
 * `text` after the body paragraphs following a blank line. The address is
 * one line per stored line — CRLF or LF, blank lines and edge whitespace
 * dropped — escaped and `<br>`-joined in HTML only.
 */
export function marketingFooter(input: MarketingFooterInput): { html: string; text: string } {
  const reason = input.footerReason;
  const addressLines = input.mailingAddress
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    html: `<p style="${FOOTER_STYLE}">${escapeHtml(reason)}</p>`
      + `<p style="${FOOTER_STYLE}">${addressLines.map(escapeHtml).join("<br>")}</p>`,
    text: [reason, addressLines.join("\n")].join("\n\n"),
  };
}
