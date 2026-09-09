import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Ground } from "./ground";

describe("Ground — the lit page layer (spec §3.1)", () => {
  const html = renderToStaticMarkup(createElement(Ground));

  it("is fixed, behind everything, non-interactive and hidden from AT", () => {
    expect(html).toContain('data-slot="ground"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/class="[^"]*pointer-events-none[^"]*fixed[^"]*inset-0[^"]*-z-10/);
  });

  it("paints three glows from the accent tokens at the token alphas", () => {
    expect(html).toContain("radial-gradient(700px 420px at 12% -10%");
    expect(html).toContain("radial-gradient(620px 380px at 96% 8%");
    expect(html).toContain("radial-gradient(560px 360px at 60% 110%");
    expect(html).toContain("var(--glow-1-alpha)");
    expect(html).toContain("var(--glow-2-alpha)");
    expect(html).toContain("var(--glow-3-alpha)");
    expect(html).toContain("var(--accent-2)");
  });

  it("paints a 48px grid at --grid-alpha, masked to the top third", () => {
    expect(html).toContain("background-size:48px 48px");
    expect(html).toContain("var(--grid-alpha)");
    expect(html).toContain("mask-image:radial-gradient(800px 500px at 30% 0%");
  });

  it("uses no colour literal — tokens only", () => {
    // `black` inside the mask is opacity, not paint (masks read alpha).
    // `rgb(from var(--accent) r g b / var(--glow-1-alpha))` is CSS relative-
    // colour syntax: every channel is a token reference (the literal `r g b`
    // are keyword placeholders, not values), so it composes a color token
    // with an alpha token without ever writing a literal colour. The regex
    // below flags a hex literal or a colour function whose FIRST argument is
    // a literal numeric channel (e.g. `rgba(139, 124, 247, .28)`) — it does
    // not match `rgb(from ...)`, whose first token is the keyword `from`.
    expect(html.replace(/mask-image:[^;]+;/g, "")).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]/,
    );
    // Sharpen, don't loosen: prove the paint is still provably token-derived.
    expect(html).toContain("rgb(from var(--accent) r g b / var(--glow-1-alpha))");
    expect(html).toContain("rgb(from var(--accent-2) r g b / var(--glow-2-alpha))");
  });
});
