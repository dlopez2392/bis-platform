import { describe, it, expect } from "vitest";
import { groundedEvidence } from "./grounding";
import type { TranscriptEvent } from "@bis/db";

const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2026-09-18T12:00:00.000Z" });

describe("groundedEvidence", () => {
  const transcript = [
    t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
    t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
  ];

  it("returns the caller's whole turn containing the quote", () => {
    expect(groundedEvidence("Call me Tuesday morning", transcript)).toBe(
      "I need a quote for a dining table. Call me Tuesday morning.",
    );
  });

  it("is insensitive to case and surrounding whitespace in the quote", () => {
    expect(groundedEvidence("  call me TUESDAY morning  ", transcript)).toBe(
      "I need a quote for a dining table. Call me Tuesday morning.",
    );
  });

  it("returns the transcript's own text, not the normalised needle (mutation: return the needle instead of turn.text -> FAILS)", () => {
    const result = groundedEvidence("call me tuesday morning", transcript);
    expect(result).toBe(transcript[1]!.text);
    expect(result).not.toBe("call me tuesday morning");
  });

  // A negation preceding the quoted span inverts its meaning; substring
  // matching cannot see it. Returning the WHOLE turn — not the excerpt —
  // is what keeps the negation visible to whoever reviews the proposal.
  it("returns the whole turn even when it opens with a negation, so the negation stays visible", () => {
    const negated = [
      t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
      t("caller", "I don't need a quote for a dining table right now."),
    ];
    expect(groundedEvidence("need a quote for a dining table", negated)).toBe(
      "I don't need a quote for a dining table right now.",
    );
  });

  it("returns null for a plausible sentence nobody said (mutation: return the turn unconditionally -> FAILS)", () => {
    expect(groundedEvidence("Call me Thursday morning", transcript)).toBeNull();
  });

  it("returns null for a span assembled across the assistant/caller join", () => {
    expect(groundedEvidence("How can I help? I need a quote", transcript)).toBeNull();
  });

  // Two CALLER turns: a mutant that concatenates every caller turn and
  // searches the join sees this quote as one continuous string, even though
  // no single turn contains it.
  it("returns null for a span straddling two separate caller turns (mutation: search the concatenated caller turns -> FAILS)", () => {
    const twoCallerTurns = [
      t("assistant", "Thanks for calling. How can I help?"),
      t("caller", "I need a quote for a dining table."),
      t("caller", "Call me Tuesday morning."),
    ];
    expect(groundedEvidence("table. Call me Tuesday", twoCallerTurns)).toBeNull();
  });

  it("returns null for empty or whitespace-only quotes (mutation: drop the word floor -> FAILS)", () => {
    expect(groundedEvidence("", transcript)).toBeNull();
    expect(groundedEvidence("   ", transcript)).toBeNull();
  });

  it("accepts a 3-word quote, right at the floor", () => {
    expect(groundedEvidence("call me Tuesday", transcript)).toBe(transcript[1]!.text);
  });

  it("refuses a 2-word quote, even though it is a real substring (mutation: lower the word floor to 2 -> FAILS)", () => {
    expect(groundedEvidence("call me", transcript)).toBeNull();
  });

  it("returns null against an empty transcript", () => {
    expect(groundedEvidence("Call me Tuesday morning", [])).toBeNull();
  });

  // Only the CALLER's words are evidence. Sofía's own sentences are the
  // model quoting itself, which grounds nothing.
  it("does not accept the assistant's own words as evidence (mutation: drop the role filter -> FAILS)", () => {
    expect(groundedEvidence("Thanks for calling 956 Woodworks", transcript)).toBeNull();
  });

  // The whitespace collapse guards the MODEL rewrapping its own quote when
  // it repeats what the caller said back — not the transcriber, which
  // across 274 real caller turns never produced a double space, a newline,
  // or an untrimmed turn.
  it("matches a quote with irregular internal whitespace (mutation: drop the whitespace collapse -> FAILS)", () => {
    expect(groundedEvidence("Call   me\n Tuesday   morning", transcript)).toBe(transcript[1]!.text);
  });

  // A phrase repeated across two caller turns: the caller retracted the
  // first and settled on the second. Citing the first turn shows the
  // reviewer the refusal, not what the caller actually decided.
  // (mutation: search with `.find` (first match) instead of `.findLast` -> FAILS,
  // returns the retraction turn instead of the settled one)
  it("cites the LAST matching caller turn when a phrase recurs, not the first", () => {
    const retracted = [
      t("caller", "I don't need a quote for a dining table."),
      t("assistant", "No problem, anything else?"),
      t("caller", "Actually, yes, I need a quote for a dining table after all."),
    ];
    expect(groundedEvidence("need a quote for a dining table", retracted)).toBe(
      "Actually, yes, I need a quote for a dining table after all.",
    );
  });

  // The database's evidence CHECK uses btrim, so a padded turn is still
  // valid stored evidence — but the doc-comment promises the citation is
  // exactly what the transcript above it already shows. Trimming would
  // break that promise for a padded turn, so the fix is to stop trimming.
  // (mutation: reintroduce `.trim()` on the returned turn -> FAILS)
  it("returns the turn's text untouched, padding and all, rather than trimming it", () => {
    const padded = [
      t("caller", "  I need a quote for a dining table. Call me Tuesday morning.  "),
    ];
    expect(groundedEvidence("Call me Tuesday morning", padded)).toBe(
      "  I need a quote for a dining table. Call me Tuesday morning.  ",
    );
  });

  // "word" must mean a run of letters/digits, not a whitespace token: an
  // en/em dash is a whitespace token with no letters, so it should never
  // clear the floor on its own.
  // (mutation: count words via `.split(" ").filter(Boolean)` instead of an
  // alnum-run match -> FAILS, this quote wrongly clears the floor)
  it("refuses a quote that only clears the floor by counting a bare dash as a word", () => {
    const dashTranscript = [t("caller", "Yes — Tuesday works for me.")];
    expect(groundedEvidence("Yes — Tuesday", dashTranscript)).toBeNull();
  });

  // A hyphenated compound is two real words joined by punctuation, not one
  // token — counting alnum runs (not whitespace tokens) gives it its full
  // word count instead of undercounting it as a single word.
  // (mutation: count words via `.split(" ").filter(Boolean)` instead of an
  // alnum-run match -> FAILS, this quote is wrongly refused as 2 words)
  it("accepts a quote whose word count only clears the floor once a hyphenated compound counts as two words", () => {
    const hyphenTranscript = [t("caller", "I'd like a walk-in appointment please.")];
    expect(groundedEvidence("walk-in appointment", hyphenTranscript)).toBe(
      "I'd like a walk-in appointment please.",
    );
  });

  // The model routinely wraps its own quote in quotation marks when it
  // repeats the caller back — that should not fail closed.
  // (mutation: drop the wrapping-quote strip -> FAILS, the literal quote
  // marks are never in the transcript so the substring search misses)
  it("strips a wrapping quotation mark from the model's quote", () => {
    expect(groundedEvidence('"Call me Tuesday morning"', transcript)).toBe(
      transcript[1]!.text,
    );
  });

  // Same failure mode when the model prefixes its quote with an ellipsis.
  // (mutation: drop the leading-ellipsis strip -> FAILS)
  it("strips a leading ellipsis from the model's quote", () => {
    expect(groundedEvidence("...call me Tuesday morning", transcript)).toBe(
      transcript[1]!.text,
    );
  });

  // The transcriber only ever emits a straight apostrophe; the MODEL is the
  // side likely to emit a curly one when it repeats the caller's words back.
  // (mutation: drop the curly-apostrophe fold -> FAILS)
  it("folds a curly apostrophe in the model's quote to match the transcript's straight one", () => {
    const negated = [
      t("caller", "I don't need a quote for a dining table right now."),
    ];
    expect(groundedEvidence("I don’t need a quote for a dining table", negated)).toBe(
      "I don't need a quote for a dining table right now.",
    );
  });
});
