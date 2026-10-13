import { FACT_LINE_MARKER } from "./summarize";

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
 * Review fix: "facts" used to mean "whichever block sits first", which read
 * 34 of 271 production calls' summaries — every one with no fact line at all,
 * prose only — as the system's own record, and (on the timeline row, which
 * only ever shows PROSE) rendered nothing for a call that DID have something
 * to say. A block earns "facts" the SAME way one earns "mismatch": by
 * starting with its own marker (`FACT_LINE_MARKER`, shared with
 * summarize.ts), never by where it happens to sit. The mismatch check still
 * runs first — a summary with no fact line at all must still show its
 * warning as a warning, not dress it up as "facts" for being first.
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
    .map((text): SummaryBlock => ({
      kind: text.startsWith(MISMATCH_MARKER) ? "mismatch" : text.startsWith(FACT_LINE_MARKER) ? "facts" : "prose",
      text,
    }));
}
