import { describe, it, expect } from "vitest";
import { emptyCallState, type CallState } from "@/lib/voice/call-state";
import { composeSummary } from "@/lib/voice/summarize";
import { splitSummaryBlocks } from "./summary-blocks";

/**
 * The fixtures are BUILT BY `composeSummary`, not hand-typed to look like its
 * output. This splitter's whole job is to take that function's format apart
 * again, and a hand-written string would keep passing after the composer
 * changed shape — the failure mode being that the honesty warning silently
 * stops being recognised as one and renders as ordinary prose.
 */
function stateWithNothingRecorded(): CallState {
  return emptyCallState();
}

describe("splitSummaryBlocks", () => {
  it("returns nothing at all for an empty summary", () => {
    // A call row whose summary never got written. There is no message key for
    // "no summary", and an empty "Summary" heading would be a worse lie than
    // no section — so the page needs zero blocks back, not one empty one.
    expect(splitSummaryBlocks("")).toEqual([]);
    expect(splitSummaryBlocks("   \n\n  \n ")).toEqual([]);
  });

  it("reads a fact-line-only summary as one facts block", () => {
    // `composeSummary` with prose that claims nothing: the fact line, alone.
    const summary = composeSummary("", stateWithNothingRecorded());
    expect(splitSummaryBlocks(summary)).toEqual([
      { kind: "facts", text: summary },
    ]);
    // Guards the fixture itself: if the composer ever stopped leading with the
    // recorded facts, the assertion above would still pass on whatever it led
    // with instead.
    expect(summary.startsWith("RECORDED —")).toBe(true);
  });

  it("splits facts / mismatch / prose when the prose contradicts the record", () => {
    const prose =
      "The caller asked about a roof inspection. An appointment was booked for Tuesday morning.";
    const summary = composeSummary(prose, stateWithNothingRecorded());
    const [facts, mismatch, notes] = splitSummaryBlocks(summary);

    expect([facts?.kind, mismatch?.kind, notes?.kind]).toEqual(["facts", "mismatch", "prose"]);
    expect(facts?.text).toBe(
      "RECORDED — Booked: no appointment was recorded · Intake: nothing captured.",
    );
    expect(mismatch?.text).toContain("⚠ MISMATCH — the notes below mention an appointment");
    // The prose is carried through UNTOUCHED. It is the likeliest record of
    // what the caller was actually told, so the page must not edit or drop it.
    expect(notes?.text).toBe(prose);
  });

  it("labels every block that isn't a marker match as prose, however many there are (mutation: classify by index 0 instead of the marker -> FAILS)", () => {
    const blocks = splitSummaryBlocks(
      "RECORDED — Booked: no appointment was recorded · Intake: nothing captured.\n\nFirst paragraph.\n\nSecond paragraph.",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["facts", "prose", "prose"]);
    expect(blocks.at(-1)?.text).toBe("Second paragraph.");
  });

  // Review fix: 34 of 271 production calls (the Resaca demo account among
  // them) have a summary with NO fact line at all — just the model's prose.
  // Classifying "facts" by POSITION (first block, whatever it is) read that
  // lone paragraph as the system's own record and, on the timeline row,
  // rendered nothing (the row only ever shows PROSE blocks). "facts" is now
  // exactly as explicit as "mismatch": a block earns it only by starting
  // with the fact line's own marker.
  it("a lone block with no fact-line marker is prose, never facts by position (mutation: classify by index 0 -> FAILS)", () => {
    const summary = "Wants a replacement quote — 18-year-old system, says it's making noise.";
    expect(splitSummaryBlocks(summary)).toEqual([{ kind: "prose", text: summary }]);
  });

  it("a lone block that DOES start with the fact-line marker is still facts (mutation: require a second block before calling anything facts -> FAILS)", () => {
    expect(splitSummaryBlocks("RECORDED — Booked: no appointment was recorded · Intake: nothing captured.")).toEqual([
      { kind: "facts", text: "RECORDED — Booked: no appointment was recorded · Intake: nothing captured." },
    ]);
  });

  it("recognises the warning by its marker wherever it sits, and never calls it facts", () => {
    // Defensive rather than hypothetical: the ordering rule is what stops a
    // summary whose fact line was lost from rendering its warning as the
    // authoritative record.
    const blocks = splitSummaryBlocks("⚠ MISMATCH — something disagrees.\n\nThe notes.");
    expect(blocks.map((b) => b.kind)).toEqual(["mismatch", "prose"]);
  });

  it("tolerates CRLF and trailing whitespace around the blank lines", () => {
    // The summary makes a round trip through Postgres and back; nothing
    // guarantees the blank line separating the blocks is a bare "\n\n".
    const blocks = splitSummaryBlocks(
      "RECORDED — facts.\r\n\r\n⚠ MISMATCH — warning.\r\n   \r\nThe notes.  ",
    );
    expect(blocks).toEqual([
      { kind: "facts", text: "RECORDED — facts." },
      { kind: "mismatch", text: "⚠ MISMATCH — warning." },
      { kind: "prose", text: "The notes." },
    ]);
  });
});
