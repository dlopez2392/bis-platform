import type { TranscriptEvent } from "@bis/db";

/**
 * The fewest words a quote must have to count as evidence.
 *
 * Not about suspicion — about not grounding on a fragment. "yes", "ok" and
 * "quote" appear in nearly every transcript, so accepting them would let a
 * proposal cite a word that supports any claim at all. A WORD count, unlike
 * a character count, does not depend on how the words happen to be spelled:
 * "call me Tuesday" and "call me Friday" are both real three-word requests,
 * where a character floor admitted one and refused the other only because
 * "Tuesday" has more letters than "Friday". The cost is the same as any
 * floor: a genuine short claim ("no, sorry") is refused for having too few
 * words, same as a fragment would be — measured live, 53 of 275 real caller
 * turns (19.3%) are under three words, so this floor alone rules out
 * verbatim citation for about a fifth of what callers actually say.
 *
 * A "word" is a run of letters or digits, not a whitespace-delimited
 * token: a bare punctuation mark ("—") is a token but has no letters, and a
 * hyphenated compound ("walk-in") is one token but two real words. Counting
 * letter/digit runs instead of whitespace tokens gets both right.
 */
const MIN_EVIDENCE_WORDS = 3;

/** Matches a run of letters or digits — this codebase's definition of "a word". */
const WORD_RUN = /[\p{L}\p{N}]+/gu;

function countWords(s: string): number {
  return (s.match(WORD_RUN) ?? []).length;
}

/** A wrapping pair of quotation marks, straight or curly, single or double. */
const WRAPPING_QUOTES: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"], // “ ”
  ["‘", "’"], // ‘ ’
];

/** Strips one layer of wrapping quotation marks the model added around its own quote. */
function stripWrappingQuote(s: string): string {
  for (const [open, close] of WRAPPING_QUOTES) {
    if (s.length > open.length + close.length - 1 && s.startsWith(open) && s.endsWith(close)) {
      return s.slice(open.length, s.length - close.length);
    }
  }
  return s;
}

/** Strips a leading ellipsis ("..." or "…") the model prefixed onto its own quote. */
const LEADING_ELLIPSIS = /^(?:\.{3}|…)\s*/;

/**
 * Case- and whitespace-insensitive fold used to compare the quote against a
 * turn's text. Also folds a curly closing/right single quote (U+2019) to a
 * straight apostrophe: the transcriber only ever emits straight apostrophes
 * (0 of 275 live caller turns carry a curly one), so the MODEL is the side
 * likely to introduce one when it repeats the caller's words back, and
 * without this fold that alone silently drops a valid proposal.
 */
function foldForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/’/g, "'");
}

/**
 * Turns the model's quote into the string searched for inside a caller
 * turn: trims it, strips one layer of quotation marks or a leading
 * ellipsis the model may have added around its own quote, then folds it
 * for comparison. Ordinary model quoting habits (wrapping its excerpt in
 * quotation marks, prefixing it with "…") must not fail closed — that
 * silently drops a valid proposal exactly when the model paraphrases
 * faithfully.
 */
function prepareNeedle(quote: string): string {
  const unwrapped = stripWrappingQuote(quote.trim()).trim();
  const unprefixed = unwrapped.replace(LEADING_ELLIPSIS, "").trim();
  return foldForMatch(unprefixed);
}

/**
 * Returns the CALLER's whole turn that contains `quote`, untouched, or
 * `null` if no caller turn does.
 *
 * The MODEL's excerpt is never what comes back — only the caller's own
 * complete sentence, verbatim from the transcript. Matching normalises case
 * and whitespace to find the excerpt inside a turn, but the string returned
 * is that turn's own untouched text. That matters because substring
 * matching cannot see a negation, qualifier or question mark that sits
 * outside the matched span but inside the same sentence — a caller who
 * said "I don't need a quote for a dining table right now" contains the
 * excerpt "need a quote for a dining table" as cleanly as one who said it
 * plainly. Returning the whole turn keeps that context in front of whoever
 * reviews the proposal, instead of a clipped quote that reads as assent.
 * It also means the stored evidence is exactly what the transcript above it
 * on the same screen already shows, rather than a separately-normalised
 * copy that can differ from it in case or spacing.
 *
 * This proves PROVENANCE, not entailment: a verbatim caller quote grounds a
 * proposal built from it, not that the proposal correctly describes what
 * the caller meant.
 *
 * Four properties, all load-bearing:
 *
 * • CALLER TURNS ONLY. Sofía's sentences are the model's own output; a
 *   proposal citing them is the model quoting itself and has grounded
 *   nothing. This is the difference between this check and
 *   `checkSummaryAgainstState`, which reconciles prose against CallState.
 *
 * • WITHIN ONE TURN, never across the join. Concatenating the transcript
 *   (or even just the caller's turns) and searching that would let a span
 *   straddle two turns and read as a sentence nobody said in one breath.
 *
 * • THE LAST MATCHING TURN, when a phrase recurs across more than one
 *   caller turn. Nothing about substring matching prefers a caller's
 *   earlier turn over a later one, so a naive first-match search can cite
 *   a retraction ("I don't need a quote for a dining table") over the
 *   turn where the caller actually settled the point ("Actually, yes, I
 *   need a quote for a dining table after all") whenever the model's quote
 *   is a phrase common to both. Taking the last match assumes the caller's
 *   most recent word on a phrase is the one that stands — true of a
 *   retraction-then-restatement, but it is still just a heuristic: this
 *   check has no notion of intent, only of which turn a substring last
 *   appeared in.
 *
 *   This does NOT cover a retraction that lands in a DIFFERENT turn than
 *   the quoted phrase — "Actually forget it, my brother is building one,
 *   don't call" retracts a dining-table quote made two turns earlier
 *   without repeating any of its words, so no turn-selection rule can
 *   catch it. A one-turn citation can only ever show what one turn said;
 *   whoever reads the evidence should treat it as the turn the quote came
 *   from, not as proof the caller never walked it back later in the call.
 *
 * • CASE- AND WHITESPACE-INSENSITIVE, because the transcriber is not
 *   consistent about case between calls, and a proposal dropped over a
 *   capital letter is a false negative nobody can debug. The whitespace
 *   collapse specifically guards the MODEL rewrapping its own quote —
 *   inserting or losing a line break when it repeats back what the caller
 *   said — not the transcript, which arrives clean in practice. The
 *   returned turn is NOT trimmed: it is the transcript's own untouched
 *   text, so what is stored as evidence is exactly what the transcript
 *   already shows above it on the same screen, padding included (the
 *   database's evidence CHECK constraint uses `btrim`, so a padded turn is
 *   still valid stored evidence either way).
 */
export function groundedEvidence(quote: string, transcript: TranscriptEvent[]): string | null {
  const needle = prepareNeedle(quote);
  if (countWords(needle) < MIN_EVIDENCE_WORDS) return null;
  const turn = transcript.findLast(
    (e) => e.role === "caller" && foldForMatch(e.text).includes(needle),
  );
  return turn ? turn.text : null;
}
