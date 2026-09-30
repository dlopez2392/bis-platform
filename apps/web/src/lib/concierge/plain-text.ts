/**
 * The concierge's bubble renders a reply exactly as written (`white-space:
 * pre-wrap`, no markdown renderer), so a model that answers "**BIS Platform**"
 * puts the asterisks on a client's website. Observed on the first live BIS
 * conversation, 2026-09-30. The prompt now asks for plain text; this is the
 * belt to that brace, because a prompt is a request and the page is public.
 *
 * Deliberately narrow: it removes only what can never be meant literally in a
 * chat reply — paired `**`/`__` emphasis and a leading `#` heading marker.
 * Line breaks, "1." and "-" list lines, single asterisks and underscores
 * (a price footnote, a snake_case word, an email address) are left alone,
 * because they read fine as text and stripping them could change meaning.
 */
export function plainText(reply: string): string {
  return reply
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
}
