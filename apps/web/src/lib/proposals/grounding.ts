import type { TranscriptEvent } from "@bis/db";

/**
 * The shortest span that can count as evidence.
 *
 * Not about suspicion — about not grounding on a fragment. "yes", "ok" and
 * "quote" appear in nearly every transcript, so accepting them would let a
 * proposal cite a word that supports any claim at all. Fifteen characters
 * is roughly the shortest real clause a caller produces ("call me Tuesday"
 * is fifteen).
 */
const MIN_EVIDENCE = 15;

/**
 * True when `evidence` is a span the CALLER actually said.
 *
 * Three properties, all load-bearing:
 *
 * • CALLER TURNS ONLY. Sofía's sentences are the model's own output; a
 *   proposal citing them is the model quoting itself and has grounded
 *   nothing. This is the difference between this check and
 *   `checkSummaryAgainstState`, which reconciles prose against CallState.
 *
 * • WITHIN ONE TURN, never across the join. Concatenating the transcript
 *   and searching it would let a span straddle two speakers and read as a
 *   sentence neither of them said.
 *
 * • CASE- AND WHITESPACE-INSENSITIVE, because the transcriber is not
 *   consistent about either between calls, and a proposal dropped over a
 *   capital letter is a false negative nobody can debug.
 */
export function isGrounded(evidence: string, transcript: TranscriptEvent[]): boolean {
  const needle = evidence.trim().toLowerCase().replace(/\s+/g, " ");
  if (needle.length < MIN_EVIDENCE) return false;
  return transcript.some(
    (e) => e.role === "caller"
      && e.text.trim().toLowerCase().replace(/\s+/g, " ").includes(needle),
  );
}
