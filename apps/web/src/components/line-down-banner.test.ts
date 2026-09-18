import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// `next/link` renders a plain anchor under a static render — same stand-in
// as zone-note.test.ts's (the other Notice-with-a-Link-inside component):
// enough for the only thing asserted about it here, which is whether an
// href to the screened list reaches the markup at all.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

const { LineDownBanner } = await import("./line-down-banner");

const render = (count: number) =>
  renderToStaticMarkup(createElement(LineDownBanner, { count }));

describe("LineDownBanner", () => {
  it("renders NOTHING at zero — it clears itself (mutation: always render -> FAILS)", () => {
    // The whole reason this is derived rather than a stored task: when the
    // number goes live the refusals stop and the banner disappears on the
    // next render. There is nothing to complete, dismiss or forget.
    expect(render(0)).toBe("");
  });

  it("says ONE number in the singular (mutation: always use the plural string -> FAILS)", () => {
    expect(renderedText(render(1))).toContain(m["work.linesDown.one"]);
  });

  it("counts in the plural above one (mutation: as above -> FAILS)", () => {
    expect(renderedText(render(3))).toContain(m["work.linesDown.many"].replace("{n}", "3"));
  });

  it("says it in WORDS, not by colour alone (mutation: delete the sentence, keep the tint -> FAILS)", () => {
    // DESIGN.md rule 3. Strip every tag and class: what is left is what a
    // reader with no colour perception receives.
    expect(renderedText(render(2)).trim().length).toBeGreaterThan(20);
  });

  it("links to the screened list (mutation: drop the link -> FAILS)", () => {
    expect(render(2)).toContain('href="/dashboard/screened"');
  });

  it("never says '1 numbers' — the plural template does not leak onto the singular count (mutation: append a stray char to the singular check -> FAILS)", () => {
    // The trap this branch already fell into once: an appended corruption
    // survives a bare toContain. Anchored on the whole phrase with a word
    // boundary, not a substring that a suffix could still satisfy.
    expect(renderedText(render(1))).toMatch(/\b1 number is turning callers away\b/);
  });
});
