/**
 * Splits a consent label into text and the bare URLs inside it.
 *
 * Why this exists: an SMS opt-in disclosure has to LINK the sender's privacy
 * policy — TCR and CTIA both require it, and A2P 10DLC campaign vetting looks
 * at the opt-in form itself as the evidence. A consent field's label is plain
 * text (`FormField.label`), and the public form renders inside an iframe on
 * the client's site, so the host page's own footer link is not on screen next
 * to the checkbox. Without this, the disclosure could name a policy it could
 * not reach.
 *
 * Bare URLs rather than markdown or an extra `href` column: the label is also
 * the CONSENT RECORD. `SubmissionConsent.text` stores exactly what the person
 * was shown, and that record has to be readable years later by someone who is
 * not looking at this renderer — a stored `[privacy policy](https://…)` is a
 * worse artefact than a stored sentence with a URL in it. Nothing is stripped
 * or rewritten on the way to storage; this only decides what is a link ON
 * SCREEN.
 *
 * `https://` only. A scheme-less "bis-rgv.com/privacy" stays plain text, and
 * `javascript:` and `data:` can never be produced by construction rather than
 * by a filter that might be wrong — this string is operator-authored, but an
 * operator is not necessarily the agency, and a form's fields are editable by
 * anyone with access to the account.
 *
 * Trailing punctuation is left OUT of the link: a sentence ending
 * "…see https://bis-rgv.com/en/privacy." must not produce a URL with a full
 * stop glued to it, which is the single most common way this kind of helper
 * ships broken.
 */
export type LabelPart = { kind: "text"; value: string } | { kind: "link"; value: string };

const URL_RE = /https:\/\/[^\s<>"]+/g;
/** Characters a sentence can end on that are never part of the address. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function labelParts(label: string): LabelPart[] {
  const parts: LabelPart[] = [];
  let last = 0;
  for (const match of label.matchAll(URL_RE)) {
    const start = match.index;
    let url = match[0];
    const trimmed = url.replace(TRAILING, "");
    // A URL that is nothing but punctuation after the scheme is not one.
    if (trimmed === "https://") continue;
    url = trimmed;
    if (start > last) parts.push({ kind: "text", value: label.slice(last, start) });
    parts.push({ kind: "link", value: url });
    last = start + url.length;
  }
  if (last < label.length) parts.push({ kind: "text", value: label.slice(last) });
  // A label with no URL in it comes back as the one text part it started as,
  // so the caller needs no special case and an existing consent field renders
  // exactly as it did before this module existed.
  return parts.length > 0 ? parts : [{ kind: "text", value: label }];
}
