// The CSS is data, so the test reads it — same shape as
// northern-lights.test.ts and design-foundation.test.ts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(path.join(here, "../../app/(dashboard)/globals.css"), "utf8");

describe("the clerk cascade layer (spec §7)", () => {
  it("is declared", () => {
    expect(globals).toMatch(/@layer\s+clerk\s*;/);
  });

  it("is declared BEFORE tailwind is imported", () => {
    // Layer priority follows declaration order: first declared is weakest.
    // Declaring `clerk` before `@import "tailwindcss"` is what keeps
    // Clerk's THEMEABLE styles (the ones `cssLayerName` routes into this
    // layer) weaker than every Tailwind utility. It is NOT why the sign-in
    // page's restyle applies — that rides on Clerk's own style-object merge
    // in that page's appearance config, indifferent to layer order entirely
    // (see that file's comment). Move this after Tailwind's import and
    // Clerk's themeable rules would outrank Tailwind wherever Clerk renders
    // — no error, no red test here, just Clerk's defaults winning silently.
    const layerAt = globals.search(/@layer\s+clerk\s*;/);
    const tailwindAt = globals.indexOf('@import "tailwindcss"');
    expect(layerAt).toBeGreaterThanOrEqual(0);
    expect(tailwindAt).toBeGreaterThanOrEqual(0);
    expect(layerAt).toBeLessThan(tailwindAt);
  });

  it("never resorts to !important to win the cascade", () => {
    // COMMENTS ARE STRIPPED FIRST, and that is not incidental: this file's own
    // commentary discusses `!important` by name, so a whole-file substring
    // match reports a declaration that does not exist. hero.test.ts fell into
    // exactly this trap — a tightened regex still matched `/* the hero one */`
    // — and its own negative control is what caught it.
    const code = globals.replace(/\/\*[\s\S]*?\*\//g, "");
    // Of the DECLARATIONS that remain, the only !important belongs to the
    // prefers-reduced-motion override, where it is correct and required — a
    // motion guard that can be out-specified is not a guard. Strip that block;
    // there must be none left. This layer only governs Clerk's THEMEABLE
    // styles against Tailwind; the sign-in restyle rides on Clerk's own
    // style-object merge instead, which no layer or specificity touches. So
    // if a Clerk style is winning on the sign-in page, this layer is almost
    // certainly IRRELEVANT — the real suspect is a missing or mistyped key
    // in that page's `elements` config (see its comment) — and reaching for
    // `!important` here would hide that instead of fixing it.
    const withoutMotionGuard = code.replace(
      /@media\s*\(prefers-reduced-motion[\s\S]*?\n\}/,
      "",
    );
    expect(withoutMotionGuard).not.toContain("!important");
    // Guard the guard: if the reduced-motion block is ever removed or
    // reshaped, the strip above silently stops covering anything and this
    // test quietly weakens into a tautology.
    expect(globals).toContain("prefers-reduced-motion");
  });
});
