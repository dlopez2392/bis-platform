import { shell, button, escapeHtml, type EmailBrand } from "./shell";

export type BillingLinkEmailInput = {
  /** BIS's own brand (DECISION 1, danlo 2026-09-25): it is BIS billing the
   *  business, so this is never the client's logo or colour. */
  brand: EmailBrand;
  /** The client's customer-facing brand name, or null. NEVER accounts.name
   *  (the agency's private label; shell.ts's rule). */
  businessName: string | null;
  planName: string;
  /** "$149.00/month" (priceLine). */
  price: string;
  /** includedLine's whole sentence: "It includes 500 minutes of calls, 1,000
   *  texts and 200 website chats each month." (zero allowances left out). */
  includes: string;
  /** Absolute payment-page URL. */
  url: string;
  /** When the link stops working, in the account's zone (formatMoment). */
  expires: string;
};

/**
 * The billing link (spec flow 2), from BIS to the client (G18). Plain words
 * for a business owner: what the plan costs, what it includes, one button,
 * and when the link runs out. It names no payment vendor and none of its
 * terms; the page the button opens says whose it is.
 */
export function billingLinkEmail(input: BillingLinkEmailInput): { subject: string; html: string; text: string } {
  const subject = input.businessName ? `Set up billing for ${input.businessName}` : "Set up your billing";
  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">Set up your billing</p>
    <p style="margin:0 0 12px;">Your ${escapeHtml(input.planName)} plan is ${escapeHtml(input.price)}. ${escapeHtml(input.includes)}</p>
    <p style="margin:0 0 20px;">Add a card on our secure payment page. It takes about two minutes.</p>
    ${button(input.brand, input.url, "Set up billing")}
    <p style="margin:20px 0 0;color:#71717a;">This link works until ${escapeHtml(input.expires)}. If it runs out, reply and we&rsquo;ll send a new one.</p>
  `);
  const text = [
    "Set up your billing",
    "",
    `Your ${input.planName} plan is ${input.price}. ${input.includes}`,
    "",
    "Add a card on our secure payment page. It takes about two minutes:",
    input.url,
    "",
    `This link works until ${input.expires}. If it runs out, reply and we'll send a new one.`,
  ].join("\n");
  return { subject, html, text };
}
