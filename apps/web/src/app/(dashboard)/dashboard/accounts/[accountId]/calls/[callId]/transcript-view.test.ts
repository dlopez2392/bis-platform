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

function render(t: TranscriptEvent[], locale: "en" | "es" = "en") {
  return renderToStaticMarkup(createElement(TranscriptView, { transcript: t, timezone: "America/Chicago", locale }));
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

  // Design review minor 3: the turn a "See it in the transcript" link lands on is marked, so the eye finds it
  // among thirty: a :target ring in the focus glow token, on the control radius.
  it("the landed-on turn is marked by a :target ring on --ring-glow (mutation: drop the target: classes -> FAILS)", () => {
    const html = render(transcript);
    const cls = (/<li[^>]*id="turn-2"[^>]*class="([^"]*)"|<li[^>]*class="([^"]*)"[^>]*id="turn-2"/.exec(html) ?? []).slice(1).join(" ").split(" ");
    expect(cls).toEqual(expect.arrayContaining(["target:ring-[3px]", "target:ring-[var(--ring-glow)]", "rounded-[var(--radius-ctl)]"]));
  });
});

// S-10 T5: the "Caller"/"Assistant" labels and the clock's own "en-US" pin
// used to ignore the reader's locale entirely.
describe("TranscriptView: Spanish (S-10 T5)", () => {
  it("renders the side labels in Spanish and the clock through tag(locale) (mutation: hard-code en-US -> FAILS)", () => {
    const en = render(transcript, "en");
    const es = render(transcript, "es");
    expect(es).toContain("Quien llamó");
    expect(es).toContain("Asistente");
    expect(es).not.toContain(">Caller<");
    expect(es).not.toContain(">Assistant<");
    // Spanish time formatting ("a. m."/"p. m.") differs from English's "AM"/"PM".
    expect(es).not.toBe(en);
  });

  it("says the Spanish empty-transcript sentence under es", () => {
    expect(render([], "es")).toContain("No se grabó transcripción de esta llamada.");
  });
});
