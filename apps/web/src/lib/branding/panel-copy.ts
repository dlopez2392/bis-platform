import { BIS_REPLY_DOMAIN, type InboundMode } from "@bis/db";
import { makeTr } from "@/lib/record/copy";
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
function agencyCopy(locale: Locale, pseudo: boolean): PanelCopy {
  const tr = makeTr(locale, pseudo);
  return {
    title: tr.text("branding.title"),
    description: tr.text("branding.body"),
    nameHint: tr.text("branding.nameHint"),
    colorHint: tr.text("branding.colorHint"),
    neutralHint: tr.text("branding.neutralHint"),
    modeHint: tr.text("branding.modeHint"),
    modeFollow: tr.text("branding.modeFollow"),
    replyToHint: tr.text("branding.replyToHint"),
    mailingAddressHint: tr.text("branding.mailingAddressHint"),
  };
}

function clientCopy(locale: Locale, pseudo: boolean): PanelCopy {
  const tr = makeTr(locale, pseudo);
  return {
    title: tr.text("branding.clientTitle"),
    description: tr.text("branding.clientBody"),
    nameHint: tr.text("branding.clientNameHint"),
    colorHint: tr.text("branding.clientColorHint"),
    neutralHint: tr.text("branding.clientNeutralHint"),
    modeHint: tr.text("branding.clientModeHint"),
    modeFollow: tr.text("branding.clientModeFollow"),
    replyToHint: tr.text("branding.clientReplyToHint"),
    mailingAddressHint: tr.text("branding.clientMailingAddressHint"),
  };
}

/** `pseudo` (S-10 T9a): the QA pseudo-locale, off by default so every
 *  existing caller (the agency's Settings card, the styleguide) renders
 *  byte-identical to before. */
export function panelCopy(audience: BrandingAudience, locale: Locale = "en", pseudo = false): PanelCopy {
  return audience === "client" ? clientCopy(locale, pseudo) : agencyCopy(locale, pseudo);
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
  audience: BrandingAudience, s: { mode: InboundMode; domain: string | null }, locale: Locale = "en", pseudo = false,
): string | null {
  if (s.mode === "off") return null;
  const domain = s.mode === "bis" ? BIS_REPLY_DOMAIN : (s.domain ?? "");
  const key = audience === "client" ? "branding.replies.client" : "branding.replies.agency";
  return makeTr(locale, pseudo).text(key, { domain });
}
