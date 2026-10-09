import { describe, it, expect } from "vitest";
import type { CallCard } from "@bis/db";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText as rawText } from "@/lib/rendered-text";
import { CallCardPanel, hasCard } from "./call-card-panel";

// A server component with no client state is a function of its props, so
// `renderToStaticMarkup` pins the served output directly (calls-table.test.ts's
// shape).
const CARD: CallCard = {
  reason: "Wants the owner to call about the leak",
  callbackNumber: "9565061545",
  callerWords: "Hi, my roof started leaking last night and I need someone out here.",
};

/** The rendered text with each run of whitespace (where a tag stood) as one space. */
const renderedText = (html: string) => rawText(html).replace(/\s+/g, " ");

function render(over: Partial<CallCard> = {}, opts: { persona?: string; language?: "en" | "es" } = {}) {
  return renderToStaticMarkup(createElement(CallCardPanel, {
    who: "Ana Reyes",
    card: { ...CARD, ...over },
    personaName: opts.persona ?? "Sofía",
    language: opts.language ?? "en",
  }));
}

describe("CallCardPanel", () => {
  it("reads in three seconds: who, why, the number and their words, each under its own label", () => {
    const text = renderedText(render());
    expect(text).toContain(`${m["calls.card.who"]} Ana Reyes`);
    expect(text).toContain(`${m["calls.card.reason"]} Wants the owner to call about the leak`);
    expect(text).toContain(`${m["calls.card.callback"]} 9565061545`);
    expect(text).toContain(`${m["calls.card.words"]} Hi, my roof started leaking last night`);
  });

  it("carries the author mark with the account's own persona (DESIGN.md provenance; mutation: hardcode \"Sofía\" → FAILS)", () => {
    expect(renderedText(render({}, { persona: "Marisol" }))).toContain("Marisol · AI");
    expect(renderedText(render())).toContain("Sofía · AI");
  });

  it("a number whose country is certain is a tap-to-call link to its E.164; one that could be US or Mexican is plain text (mutation: always link → tel:+15512345678, FAILS)", () => {
    expect(render()).toContain('href="tel:+19565061545"');
    expect(render({ callbackNumber: "+19562921696" })).toContain('href="tel:+19562921696"');
    const ambiguous = render({ callbackNumber: "55 1234 5678" });
    expect(ambiguous).toContain("55 1234 5678");
    expect(ambiguous).not.toContain("tel:");
  });

  it("says plainly what is missing rather than leaving a blank: no reason, no number (mutation: render the row only when set → the label vanishes, FAILS)", () => {
    const text = renderedText(render({ reason: null, callbackNumber: null }));
    expect(text).toContain(`${m["calls.card.reason"]} ${m["calls.card.reasonUnknown"]}`);
    expect(text).toContain(`${m["calls.card.callback"]} ${m["calls.card.callbackUnknown"]}`);
  });

  it("no words → no words row; the caller's words carry the language they were spoken in", () => {
    expect(renderedText(render({ callerWords: null }))).not.toContain(m["calls.card.words"]);
    expect(render({}, { language: "es" })).toMatch(/<q[^>]*lang="es"/);
  });

  it("hasCard: a card of three nulls is no card (older calls, spam), anything set is one", () => {
    expect(hasCard(null)).toBe(false);
    expect(hasCard({ reason: null, callbackNumber: null, callerWords: null })).toBe(false);
    expect(hasCard({ reason: null, callbackNumber: "+19562921696", callerWords: null })).toBe(true);
  });
});
