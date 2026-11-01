import { BIS_REPLY_DOMAIN, type InboundMode } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Who is reading the branding panel.
 *
 * The panel renders on two surfaces: the agency's Settings page, where it is
 * one card among several and describes a company that is not the reader's, and
 * the client's own /branding page, where the reader IS that company. Every
 * string that names whose brand it is has to change with that.
 *
 * M4c parameterised the heading and body and stopped there, so five hints kept
 * the agency's voice on the client's page. Collecting the whole set in one
 * place is what makes the omission visible — and testable, since the panel
 * itself is a .tsx and this workspace's vitest only picks up .test.ts.
 */
export type BrandingAudience = "agency" | "client";

export type PanelCopy = {
  title: string;
  description: string;
  nameHint: string;
  colorHint: string;
  neutralHint: string;
  modeHint: string;
  /** A radio OPTION label, not a hint — "Follow their device" reads as a third
   *  party's device when the reader is the company itself. */
  modeFollow: string;
  /** Where a reply goes. The agency wording names the BIS mailbox as the
   *  fallback; the client's says "us", because naming our own mailbox to a
   *  client explains nothing and describes plumbing they do not have. */
  replyToHint: string;
  /** Under the mailing-address box (migration 0048): where the address is
   *  printed, and why it has to be a real one. */
  mailingAddressHint: string;
};

/**
 * S-10 T6: these were module-level English constants, built once at
 * import — branding-panel.tsx read them directly, English regardless of
 * the reader's own stored choice. Now functions of locale (default "en",
 * so the agency's Settings card, which never passes a locale, is
 * byte-identical to before).
 */
function agencyCopy(locale: Locale): PanelCopy {
  return {
    title: t(m, "branding.title", locale),
    description: t(m, "branding.body", locale),
    nameHint: t(m, "branding.nameHint", locale),
    colorHint: t(m, "branding.colorHint", locale),
    neutralHint: t(m, "branding.neutralHint", locale),
    modeHint: t(m, "branding.modeHint", locale),
    modeFollow: t(m, "branding.modeFollow", locale),
    replyToHint: t(m, "branding.replyToHint", locale),
    mailingAddressHint: t(m, "branding.mailingAddressHint", locale),
  };
}

function clientCopy(locale: Locale): PanelCopy {
  return {
    title: t(m, "branding.clientTitle", locale),
    description: t(m, "branding.clientBody", locale),
    nameHint: t(m, "branding.clientNameHint", locale),
    colorHint: t(m, "branding.clientColorHint", locale),
    neutralHint: t(m, "branding.clientNeutralHint", locale),
    modeHint: t(m, "branding.clientModeHint", locale),
    modeFollow: t(m, "branding.clientModeFollow", locale),
    replyToHint: t(m, "branding.clientReplyToHint", locale),
    mailingAddressHint: t(m, "branding.clientMailingAddressHint", locale),
  };
}

export function panelCopy(audience: BrandingAudience, locale: Locale = "en"): PanelCopy {
  return audience === "client" ? clientCopy(locale) : agencyCopy(locale);
}

/**
 * The read-only "where your customers' replies go" line under Branding's
 * reply-to hint (S-06 part 1, Task 10). `null` for Replies off — there is
 * nothing to say: the reply-to hint above it already covers that case.
 * The domain named is BIS_REPLY_DOMAIN for mode "bis" (the shared mailbox
 * every unthemed account's replies land in) or the account's own stored
 * domain for "own_domain" — never the other way around, which would tell an
 * operator customers reply to a domain nothing is actually listening on.
 */
export function repliesLine(
  audience: BrandingAudience, s: { mode: InboundMode; domain: string | null }, locale: Locale = "en",
): string | null {
  if (s.mode === "off") return null;
  const domain = s.mode === "bis" ? BIS_REPLY_DOMAIN : (s.domain ?? "");
  const key = audience === "client" ? "branding.replies.client" : "branding.replies.agency";
  return t(m, key, locale, { domain });
}
