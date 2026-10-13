import { shell, escapeHtml, type EmailBrand } from "./shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { PublicLocale } from "@/lib/forms/public-strings";

export type BookingFollowupInput = {
  brand: EmailBrand;
  /** Operator-authored plain text, straight from the calendar's
   *  `followup_body` column (`""` when the operator never wrote one —
   *  `listDueFollowups` never returns `null` here). Split on blank lines
   *  into paragraphs: the operator writes prose, not markup, so a paragraph
   *  break is inferred the way a human reading it would, rather than making
   *  them author HTML. */
  body: string;
  /** S-09 PR 2: the customer's language. English by default. */
  locale?: PublicLocale;
};

/** The copy sent when the operator never wrote a follow-up body. Exported so
 *  the route/tests can assert against the same string rather than a copy
 *  pasted at each call site drifting out of sync with this one. */
export const DEFAULT_FOLLOWUP_BODY: string = m["email.followup.defaultBody"];

/** Same default, in `locale`. */
export function defaultFollowupBody(locale: PublicLocale): string {
  return t(m, "email.followup.defaultBody", locale);
}

/**
 * The follow-up sent ~a day after a booking's meeting ends.
 *
 * Customer-facing and restrained, like `outboundEmail`: a small branded
 * header and the operator's own paragraphs, no button and no footer — a
 * follow-up reads like a short personal note, not a marketing email, and
 * there is no single call-to-action here the way a cancel link or a
 * video-join button is elsewhere in this codebase.
 */
export function bookingFollowupEmail(input: BookingFollowupInput):
  { subject: string; html: string; text: string } {
  const locale = input.locale ?? "en";
  const raw = input.body.trim() ? input.body : defaultFollowupBody(locale);

  // Blank lines are the paragraph break, not every single newline the way
  // outboundEmail's <br/> replacement treats them -- a follow-up reads like
  // a short letter, not a chat message. `\s*` inside the pattern absorbs a
  // blank "line" that's actually a run of spaces/tabs, not just `\n\n`.
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = shell(
    input.brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join(""),
  );

  // Composed from the same paragraph list the html used, never derived by
  // stripping tags -- so a text-only client sees exactly the operator's
  // paragraph breaks too.
  const text = paragraphs.join("\n\n");

  return {
    subject: t(m, "email.followup.subject", locale, { name: input.brand.name }),
    html,
    text,
  };
}
