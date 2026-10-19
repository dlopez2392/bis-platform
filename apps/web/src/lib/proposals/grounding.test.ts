import { describe, it, expect } from "vitest";
import { groundedEvidence, groundedTurn } from "./grounding";
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

// Item 8b-1 (plan Task 4, deviation 5): the generator stores WHERE the evidence came from, so the turn
// itself is returned beside its text. groundedEvidence is now groundedTurn(...)?.text.
describe("groundedTurn", () => {
  const at = (role: "caller" | "assistant", text: string, when: string): TranscriptEvent => ({ role, text, at: when });

  it("returns the LAST matching caller turn's text, index and at (mutation: findIndex for findLastIndex -> FAILS)", () => {
    const transcript = [
      at("assistant", "Thanks for calling. How can I help?", "2026-09-18T12:00:00.000Z"),
      at("caller", "I need a quote for a dining table.", "2026-09-18T12:00:05.000Z"),
      at("assistant", "Sure, anything else?", "2026-09-18T12:00:09.000Z"),
      at("caller", "Yes, I need a quote for a dining table and chairs.", "2026-09-18T12:00:14.000Z"),
    ];
    expect(groundedTurn("need a quote for a dining table", transcript)).toEqual({
      text: "Yes, I need a quote for a dining table and chairs.", index: 3, at: "2026-09-18T12:00:14.000Z",
    });
  });

  it("returns null where groundedEvidence does", () => {
    const transcript = [t("caller", "I need a quote for a dining table.")];
    expect(groundedTurn("Call me Thursday morning", transcript)).toBeNull();
    expect(groundedTurn("call me", transcript)).toBeNull();
  });

  // Parity with 0088's evidence CHECK, `length(btrim(evidence)) > 0`: btrim strips only ASCII
  // spaces, so the database ACCEPTS a tab-only or NBSP-only string. Nothing this matcher returns is
  // ever such a string, because the needle must hold three runs of letters or digits and the turn
  // must contain it. Dropping the word floor would let an empty needle match the last caller turn,
  // here a tab-only one, which the CHECK would then store as evidence.
  it("never grounds on whitespace of any class, so it never hands the database a blank the CHECK lets through (mutation: drop the word floor -> FAILS)", () => {
    const blankTurns = [t("caller", "I need a quote for a dining table."), t("caller", "\u00a0\n"), t("caller", "\t\t")];
    for (const quote of ["", "   ", "\t", "\t \n", "\u00a0", "\u2003\u00a0"]) {
      expect(groundedTurn(quote, blankTurns)).toBeNull();
    }
  });

  // Every existing groundedEvidence case above, through groundedTurn: the text is the same turn, typed
  // out, and groundedEvidence answers exactly that text.
  it("groundedEvidence equals groundedTurn(...)?.text for every existing case (mutation: return the needle -> FAILS)", () => {
    const base = [
      t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
      t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
    ];
    const cases: [string, TranscriptEvent[], string | null][] = [
      ["Call me Tuesday morning", base, "I need a quote for a dining table. Call me Tuesday morning."],
      ["  call me TUESDAY morning  ", base, "I need a quote for a dining table. Call me Tuesday morning."],
      ["call me tuesday morning", base, "I need a quote for a dining table. Call me Tuesday morning."],
      ["need a quote for a dining table", [t("caller", "I don't need a quote for a dining table right now.")], "I don't need a quote for a dining table right now."],
      ["Call me Thursday morning", base, null],
      ["How can I help? I need a quote", base, null],
      ["table. Call me Tuesday", [t("caller", "I need a quote for a dining table."), t("caller", "Call me Tuesday morning.")], null],
      ["", base, null],
      ["   ", base, null],
      ["call me Tuesday", base, "I need a quote for a dining table. Call me Tuesday morning."],
      ["call me", base, null],
      ["Call me Tuesday morning", [], null],
      ["Thanks for calling 956 Woodworks", base, null],
      ["Call   me\n Tuesday   morning", base, "I need a quote for a dining table. Call me Tuesday morning."],
      ["need a quote for a dining table", [
        t("caller", "I don't need a quote for a dining table."), t("assistant", "No problem, anything else?"),
        t("caller", "Actually, yes, I need a quote for a dining table after all."),
      ], "Actually, yes, I need a quote for a dining table after all."],
      ["Call me Tuesday morning", [t("caller", "  I need a quote for a dining table. Call me Tuesday morning.  ")], "  I need a quote for a dining table. Call me Tuesday morning.  "],
      ["Yes — Tuesday", [t("caller", "Yes — Tuesday works for me.")], null],
      ["walk-in appointment", [t("caller", "I'd like a walk-in appointment please.")], "I'd like a walk-in appointment please."],
      ['"Call me Tuesday morning"', base, "I need a quote for a dining table. Call me Tuesday morning."],
      ["...call me Tuesday morning", base, "I need a quote for a dining table. Call me Tuesday morning."],
      ["I don’t need a quote for a dining table", [t("caller", "I don't need a quote for a dining table right now.")], "I don't need a quote for a dining table right now."],
    ];
    for (const [quote, transcript, want] of cases) {
      expect(groundedTurn(quote, transcript)?.text ?? null, quote).toBe(want);
      expect(groundedEvidence(quote, transcript), quote).toBe(want);
    }
  });
});
