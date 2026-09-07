import { brandLogoUrl, type Branding } from "@bis/db";
import { publicFormTheme, type FormAccent } from "@/lib/branding/public-form-theme";

export type EmailBrand = {
  /** What the reader should see. NEVER `accounts.name`: that column is the
   *  agency's internal label for the company ("Rio Roofing — trial") and is
   *  not for the client's eyes, still less their customer's. Since the
   *  resolver lost its second parameter there is no longer any way to put it
   *  here. */
  name: string;
  logoUrl: string | null;
  accent: FormAccent;
};

/**
 * The company name a CUSTOMER may be shown, from anywhere — email From line,
 * SMS body, booking page. `accounts.brand_name`, trimmed, AND NOTHING ELSE.
 *
 * THERE IS NO FALLBACK, deliberately. `accounts.name` is the agency's
 * internal label for the company ("Rio Roofing — trial") and it reached
 * customers three times while this resolver still took it as a second
 * argument: the P5 copy, the email From line (M4d, see
 * conversations/actions.ts's send) and the missed-call text-back, which
 * signed every message with it. A parameter that carries the label is a
 * parameter someone passes; removing it is what makes the leak impossible
 * rather than merely discouraged.
 *
 * A blank result is unreachable through the product: `createAccount` seeds
 * `brand_name` from the name given at creation, the Branding save refuses to
 * blank it, go-live requires the branding step, and migration 0028 backfilled
 * the rows that predate all three. A caller that still sees "" is looking at
 * an account built outside those paths, and the honest answer is a nameless
 * message — never the agency's private note about the client. Downstream copy
 * handles it: `defaultTextbackBody` drops the identifying clause rather than
 * inventing a company name.
 *
 * Kept separate from `emailBrand` below so a non-email caller can resolve the
 * name without dragging the logo and accent-colour math along — and so there
 * is never a second, subtly different copy of the rule.
 *
 * `packages/db/src/branding.ts` carries a deliberate second copy for the
 * automations due-lists (the data layer cannot import this module, and this
 * module cannot import that one without breaking every factory mock of
 * `@bis/db` in the web tests). brand-name-parity.test.ts pins them equal.
 */
export function brandDisplayName(branding: Branding): string {
  return branding.brandName?.trim() || "";
}

/**
 * `emailBrand` for a caller that has ALREADY resolved the customer-facing
 * name — the automations passes, whose due-rows carry `brandName` and never
 * `accounts.name`. `emailBrand` below is the same thing for a caller holding
 * only the `Branding`, and resolves that name itself.
 */
export function emailBrandNamed(branding: Branding, name: string): EmailBrand {
  return {
    name,
    logoUrl: branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null,
    // `false`, not `true`: an email card sits on white, which is exactly what
    // this resolver lifts against. It returns the brand colour raised until it
    // can carry a legible label, plus that label's colour. Using the raw hex
    // here would reintroduce the two AA defects M4b found live in production.
    accent: publicFormTheme(branding, false).formAccent,
  };
}

export function emailBrand(branding: Branding): EmailBrand {
  return emailBrandNamed(branding, brandDisplayName(branding));
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
