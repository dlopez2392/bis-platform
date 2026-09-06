import { brandLogoUrl, type Branding } from "@bis/db";
import { publicFormTheme, type FormAccent } from "@/lib/branding/public-form-theme";

export type EmailBrand = {
  /** What the reader should see. NEVER `accounts.name` when a brand name
   *  exists: that column is the agency's internal label for the company
   *  ("Rio Roofing — trial") and is not for the client's eyes, still less
   *  their customer's. */
  name: string;
  logoUrl: string | null;
  accent: FormAccent;
};

/**
 * The company name a CUSTOMER may be shown, from anywhere — email From line,
 * SMS body, booking page.
 *
 * `accounts.name` is the agency's internal label for the company ("Rio
 * Roofing — trial"); `accounts.brand_name` is what the client's own customers
 * know them as. This is the one definition of that choice, deliberately
 * separate from `emailBrand` below so a non-email caller can resolve the name
 * without dragging the logo and accent-colour math along — and so there is
 * never a second, subtly different copy of the rule. It has been re-derived
 * twice already: once on the email From line (fixed in M4d, see
 * conversations/actions.ts's send), and once in the missed-call text-back,
 * which signed every message with the internal label.
 */
export function brandDisplayName(branding: Branding, accountName: string): string {
  return branding.brandName ?? accountName;
}

export function emailBrand(branding: Branding, accountName: string): EmailBrand {
  return {
    name: brandDisplayName(branding, accountName),
    logoUrl: branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null,
    // `false`, not `true`: an email card sits on white, which is exactly what
    // this resolver lifts against. It returns the brand colour raised until it
    // can carry a legible label, plus that label's colour. Using the raw hex
    // here would reintroduce the two AA defects M4b found live in production.
    accent: publicFormTheme(branding, false).formAccent,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The outer chrome, in the dialect email clients actually accept: tables for
 * layout, inline styles only. Clients strip `<style>` blocks, ignore flexbox
 * and grid, and Outlook renders through Word.
 *
 * The brand NAME is text and the logo is decorative beside it, because most
 * clients block remote images until the reader allows them. A blocked image
 * must cost recognition, never identification — so the logo carries an empty
 * alt and the name stands on its own.
 */
export function shell(brand: EmailBrand, bodyHtml: string): string {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" width="32" height="32" `
      + `style="display:block;border:0;max-height:32px;width:auto;" />`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background-color:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#f4f4f5;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:560px;background-color:#ffffff;border-radius:8px;padding:24px;
                  font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;
                  font-size:15px;line-height:1.5;color:#18181b;">
      <tr><td style="padding-bottom:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          ${logo ? `<td style="padding-right:8px;">${logo}</td>` : ""}
          <td style="font-weight:600;font-size:16px;">${escapeHtml(brand.name)}</td>
        </tr></table>
      </td></tr>
      <tr><td>${bodyHtml}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * A link styled as a button.
 *
 * `background-color`, not the `background` shorthand: Outlook ignores the
 * shorthand and would render an unstyled link on a white card.
 */
export function button(brand: EmailBrand, href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" `
    + `style="display:inline-block;padding:10px 18px;border-radius:6px;text-decoration:none;`
    + `font-weight:600;background-color:${brand.accent.accent};`
    + `color:${brand.accent.accentForeground};">${escapeHtml(label)}</a>`;
}
