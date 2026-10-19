import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TranscriptEvent } from "@bis/db";
import { TranscriptView } from "./transcript-view";

/**
 * The transcript's turn anchors (item 8b-2, spec 5.5, plan A1). A suggestion's `evidence_ref.turn` is the
 * RAW index into the stored transcript (groundedTurn's findLastIndex over the array finishCallRow stores),
 * while this view drops turns with no words. The anchor must therefore carry the raw index, or a link to
 * "#turn-2" lands one turn early whenever an empty turn came before it.
 */
const AT = "2026-10-14T15:00:00.000Z";
const transcript: TranscriptEvent[] = [
  { role: "assistant", text: "Hello, this is Sofía.", at: AT },
  { role: "caller", text: "   ", at: AT },
  { role: "caller", text: "Call me back Tuesday.", at: AT },
];

function render(t: TranscriptEvent[]) {
  return renderToStaticMarkup(createElement(TranscriptView, { transcript: t, timezone: "America/Chicago" }));
}

describe("TranscriptView: turn anchors", () => {
  it("each shown turn's <li> carries id=\"turn-{raw index}\", skipping the dropped turn's number (mutation: the filtered index -> FAILS)", () => {
    const html = render(transcript);
    const ids = [...html.matchAll(/<li[^>]*\bid="(turn-\d+)"/g)].map((x) => x[1]);
    expect(ids).toEqual(["turn-0", "turn-2"]);
    // The cited turn is the one carrying the caller's words, not the empty one.
    expect(html).toMatch(/<li[^>]*id="turn-2"[^>]*>[\s\S]*?Call me back Tuesday\.[\s\S]*?<\/li>/);
    expect(html).not.toContain('id="turn-1"');
  });

  it("an anchored turn clears the sticky header when scrolled to (scroll-mt-20)", () => {
    const html = render(transcript);
    expect(html).toMatch(/<li[^>]*id="turn-2"[^>]*class="[^"]*\bscroll-mt-20\b|<li[^>]*class="[^"]*\bscroll-mt-20\b[^"]*"[^>]*id="turn-2"/);
  });
});
