import { shell, escapeHtml, type EmailBrand } from "./shell";

export type BookingFollowupInput = {
  brand: EmailBrand;
  /** Operator-authored plain text, straight from the calendar's
   *  `followup_body` column (`""` when the operator never wrote one —
   *  `listDueFollowups` never returns `null` here). Split on blank lines
   *  into paragraphs: the operator writes prose, not markup, so a paragraph
   *  break is inferred the way a human reading it would, rather than making
   *  them author HTML. */
  body: string;
};

/** The copy sent when the operator never wrote a follow-up body. Exported so
 *  the route/tests can assert against the same string rather than a copy
 *  pasted at each call site drifting out of sync with this one. */
export const DEFAULT_FOLLOWUP_BODY =
  "Thanks for coming in! If you have any questions or want to book again, "
  + "just reply to this email.";

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
  const raw = input.body.trim() ? input.body : DEFAULT_FOLLOWUP_BODY;

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
    subject: `Thanks from ${input.brand.name}`,
    html,
    text,
  };
}
