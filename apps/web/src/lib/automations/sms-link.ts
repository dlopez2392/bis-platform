/**
 * THE ONE PLACE a link is appended to an SMS body. Every settings-page
 * counter and every pass that sends a text with a link on the end calls
 * this with the same inputs, so the count the operator approves is the
 * count that sends — the preview-vs-send drift fixed twice on 2026-09-06
 * cannot recur by construction. No template tokens: the operator writes
 * prose, the link goes on the end, always.
 *
 * An empty link yields the body alone — what a counter shows before the
 * link exists, and what a send never does (each pass refuses first).
 */
export function withTrailingLink(body: string, link: string): string {
  return [body.trim(), link.trim()].filter(Boolean).join(" ");
}
