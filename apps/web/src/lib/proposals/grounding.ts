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
 * words, same as a fragment would be.
 */
const MIN_EVIDENCE_WORDS = 3;

/**
 * Returns the CALLER's whole turn that contains `quote`, trimmed, or `null`
 * if no caller turn does.
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
 * Three properties, all load-bearing:
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
 * • CASE- AND WHITESPACE-INSENSITIVE, because the transcriber is not
 *   consistent about case between calls, and a proposal dropped over a
 *   capital letter is a false negative nobody can debug. The whitespace
 *   collapse specifically guards the MODEL rewrapping its own quote —
 *   inserting or losing a line break when it repeats back what the caller
 *   said — not the transcript, which arrives clean in practice.
 */
export function groundedEvidence(quote: string, transcript: TranscriptEvent[]): string | null {
  const needle = quote.trim().toLowerCase().replace(/\s+/g, " ");
  if (needle.split(" ").filter(Boolean).length < MIN_EVIDENCE_WORDS) return null;
  const turn = transcript.find(
    (e) => e.role === "caller"
      && e.text.toLowerCase().replace(/\s+/g, " ").includes(needle),
  );
  return turn ? turn.text.trim() : null;
}
