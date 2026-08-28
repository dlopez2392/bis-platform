/** The three things a stored summary can be made of, in the order
 *  `composeSummary` writes them. */
export type SummaryBlockKind = "facts" | "mismatch" | "prose";

export type SummaryBlock = { kind: SummaryBlockKind; text: string };

/**
 * The marker `composeSummary` writes ahead of the honesty warning. A literal,
 * not a loose /mismatch/i — the word could plausibly appear in a model's prose
 * ("the caller noted a mismatch in the quote"), and treating that paragraph as
 * the system's own warning would be a fabricated alarm on a page whose entire
 * point is not fabricating things.
 */
const MISMATCH_MARKER = "⚠ MISMATCH";

/**
 * Takes a stored `calls.summary` apart into the blocks it was composed from,
 * so the page can give each one the weight it has earned:
 *
 *   1. the fact line — what the SYSTEM recorded, never the model's word for it;
 *   2. an optional `⚠ MISMATCH` paragraph — raised when the prose claims
 *      something the recorded state contradicts;
 *   3. the model's prose.
 *
 * Written by `composeSummary` (lib/voice/summarize.ts) joined on blank lines.
 * Split rather than parsed: the text is passed through verbatim and never
 * rewritten, because the prose is the closest thing on file to what the caller
 * was actually told.
 *
 * The mismatch test runs BEFORE the "first block is the facts" rule, not after.
 * If a summary ever reaches this page without its fact line, the warning must
 * still render as a warning — labelling it `facts` would dress the one block
 * that says "do not trust what follows" as the authoritative record.
 */
export function splitSummaryBlocks(summary: string): SummaryBlock[] {
  return summary
    // `\n\s*\n` rather than a literal "\n\n": the summary round-trips through
    // Postgres, and a CRLF or a line of spaces between the blocks would
    // otherwise fuse two of them into one — silently gluing the warning onto
    // the fact line.
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((text, i): SummaryBlock => ({
      kind: text.startsWith(MISMATCH_MARKER) ? "mismatch" : i === 0 ? "facts" : "prose",
      text,
    }));
}
