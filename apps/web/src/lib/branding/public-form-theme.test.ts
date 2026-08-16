import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Branding } from "@bis/db";
import { contrastRatio, FORM_ACCENT_FALLBACK } from "./color";
import { NEUTRAL_RAMPS } from "./neutral-ramps";
import {
  FORM_CSS_FALLBACKS, publicFormTheme, serializeDeclarations,
} from "./public-form-theme";

const NONE: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

const branding = (over: Partial<Branding>): Branding => ({ ...NONE, ...over });

/** The style object, indexable — every key it carries is a custom property. */
const style = (b: Branding, transparent = false) =>
  publicFormTheme(b, transparent).style as unknown as Record<string, string>;

describe("publicFormTheme — what engages the theme", () => {
  it("paints no tokens at all when no theme control is set", () => {
    const result = publicFormTheme(NONE, false);
    expect(result.themed).toBe(false);
    expect(result.darkCss).toBeNull();
    // The CTA pair and nothing else: form.css's own fallbacks are what render,
    // which is the compatibility promise for every account that has never
    // opened the branding panel.
    expect(Object.keys(result.style as object).sort())
      .toEqual(["--form-accent", "--form-accent-foreground"]);
  });

  // Same rule as the workspace: PR #10 shipped brand_color as accents-only, so
  // an agency that set only a colour must not find a deploy has repainted its
  // clients' forms.
  it("still paints no tokens for a colour with no other input", () => {
    const result = publicFormTheme(branding({ brandColor: "#1e3a8a" }), false);
    expect(result.themed).toBe(false);
    expect(result.style).not.toHaveProperty("--background");
    // The colour still reaches the CTA, exactly as it does today.
    expect(result.formAccent.accent).toBe("#1e3a8a");
  });

  it("engages on any one of the four controls", () => {
    for (const one of [
      { brandNeutral: "warm" as const }, { brandCorners: "sharp" as const },
      { brandType: "inter" as const }, { brandMode: "dark" as const },
    ]) {
      expect(publicFormTheme(branding(one), false).themed, JSON.stringify(one)).toBe(true);
    }
  });
});

describe("publicFormTheme — mode selection", () => {
  it("paints the light set and no dark rule when the mode is unset", () => {
    const b = branding({ brandNeutral: "warm" });
    expect(style(b)["--background"]).toBe(NEUTRAL_RAMPS.warm.light.bg);
    expect(style(b).colorScheme).toBe("light");
    expect(publicFormTheme(b, false).darkCss).toBeNull();
  });

  it("paints the light set for mode light", () => {
    const b = branding({ brandNeutral: "cool", brandMode: "light" });
    expect(style(b)["--background"]).toBe(NEUTRAL_RAMPS.cool.light.bg);
    expect(publicFormTheme(b, false).darkCss).toBeNull();
  });

  it("paints the dark set for mode dark, with no rule to follow", () => {
    const b = branding({ brandNeutral: "cool", brandMode: "dark" });
    expect(style(b)["--background"]).toBe(NEUTRAL_RAMPS.cool.dark.bg);
    expect(style(b).colorScheme).toBe("dark");
    expect(publicFormTheme(b, false).darkCss).toBeNull();
  });

  // "follow the device" that quietly resolves to light is the same shape of
  // failure brand_type had for the whole of M4a: configured, plausible, inert.
  it("paints light inline and carries the dark set in a media rule for follow", () => {
    const b = branding({ brandNeutral: "warm", brandMode: "follow" });
    expect(style(b)["--background"]).toBe(NEUTRAL_RAMPS.warm.light.bg);

    const css = publicFormTheme(b, false).darkCss!;
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("[data-tenant-theme]");
    expect(css).toContain(`--background:${NEUTRAL_RAMPS.warm.dark.bg}`);
    expect(css).toContain(`--foreground:${NEUTRAL_RAMPS.warm.dark.fg}`);
    expect(css).toContain("color-scheme:dark");
  });

  // The rule selects the same element the light tokens are an INLINE style on,
  // and an inline declaration outranks any author rule. Without !important the
  // block parses, matches, and changes nothing.
  it("marks every declaration in the dark rule important", () => {
    const css = publicFormTheme(
      branding({ brandNeutral: "warm", brandMode: "follow" }), false,
    ).darkCss!;
    // The declarations only — read from INSIDE the rule's braces. Matching
    // `name: value` across the whole string also matches the media condition
    // itself, and `prefers-color-scheme` contains the literal `color-scheme`,
    // so a filter on the token name silently readmits it.
    const block = css.match(/\[data-tenant-theme\]\{([^}]*)\}/)![1]!;
    const declarations = block.split(";").filter((d) => d.trim() !== "");
    expect(declarations.length).toBeGreaterThan(10);
    for (const d of declarations) expect(d, d).toContain("!important");
  });

  it("gives the dark rule its own CTA, lifted against the dark surfaces", () => {
    const b = branding({ brandNeutral: "warm", brandMode: "follow", brandColor: "#1e3a8a" });
    const result = publicFormTheme(b, false);
    const lightCta = result.formAccent.accent;
    const darkCta = result.darkCss!.match(/--form-accent:(#[0-9a-f]{6})/)![1]!;
    // #1e3a8a is 1.6:1 on the warm dark background: if the rule simply copied
    // the light answer, the dark form's Submit button would vanish into it.
    expect(darkCta).not.toBe("#1e3a8a");
    expect(darkCta).not.toBe(lightCta);
    expect(contrastRatio(darkCta, NEUTRAL_RAMPS.warm.dark.bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("publicFormTheme — a transparent embed", () => {
  const b = branding({
    brandNeutral: "warm", brandCorners: "round", brandType: "serif",
    brandMode: "dark", brandColor: "#1e3a8a",
  });

  it("keeps corners, typeface and the CTA and drops every surface", () => {
    const s = style(b, true);
    expect(Object.keys(s).sort()).toEqual(
      ["--font-sans", "--form-accent", "--form-accent-foreground", "--radius"],
    );
    expect(s["--radius"]).toBe("1rem");
    expect(s["--font-sans"]).toBe("var(--font-source-serif)");
  });

  it("drops the mode too, so a dark tenant cannot paint near-white on a white host page", () => {
    const s = style(b, true);
    expect(s).not.toHaveProperty("--foreground");
    expect(s).not.toHaveProperty("colorScheme");
    expect(publicFormTheme(b, true).darkCss).toBeNull();
  });

  it("carries no dark rule even for a follow tenant", () => {
    // Neither corners nor typeface change with mode, so the rule would carry
    // nothing — and the host page's backdrop is not ours to answer for.
    const follow = branding({ brandNeutral: "warm", brandMode: "follow" });
    expect(publicFormTheme(follow, true).darkCss).toBeNull();
  });

  it("measures the CTA against white, the surface the host page most likely has", () => {
    const cta = publicFormTheme(b, true).formAccent;
    expect(contrastRatio(cta.accent, "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});

describe("publicFormTheme — the CTA", () => {
  it("keeps a brand colour that already clears its surfaces untouched", () => {
    // Today's behaviour for every colour that was already visible on white.
    expect(publicFormTheme(branding({ brandColor: "#1e3a8a" }), false).formAccent)
      .toEqual({ accent: "#1e3a8a", accentForeground: "#ffffff" });
  });

  it("falls back to BIS violet when there is no brand colour", () => {
    expect(publicFormTheme(NONE, false).formAccent.accent).toBe(FORM_ACCENT_FALLBACK);
  });

  it("ignores a colour that is not a real hex", () => {
    expect(publicFormTheme(branding({ brandColor: "red; position:fixed" }), false).formAccent.accent)
      .toBe(FORM_ACCENT_FALLBACK);
  });

  it("lifts a colour that cannot be seen against a dark tenant's own surfaces", () => {
    const b = branding({ brandNeutral: "warm", brandMode: "dark", brandColor: "#1e3a8a" });
    const { accent } = publicFormTheme(b, false).formAccent;
    expect(accent).not.toBe("#1e3a8a");
    expect(contrastRatio(accent, NEUTRAL_RAMPS.warm.dark.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(accent, NEUTRAL_RAMPS.warm.dark.card)).toBeGreaterThanOrEqual(3);
  });

  // Not --primary: deriveTheme lifts that to the 4.5:1 TEXT floor because it
  // doubles as 12px link text, which walks a client's button further off the
  // colour they chose than this element owes.
  it("does not simply reuse the derived primary", () => {
    const b = branding({ brandNeutral: "warm", brandMode: "dark", brandColor: "#1e3a8a" });
    const s = style(b);
    expect(s["--form-accent"]).not.toBe(s["--primary"]);
  });
});

describe("publicFormTheme — the validation error", () => {
  it("lifts the red a dark tenant would otherwise read at 2.93:1", () => {
    const b = branding({ brandNeutral: "warm", brandMode: "dark" });
    const error = style(b)["--form-error"]!;
    expect(error).not.toBe("#b91c1c");
    expect(contrastRatio(error, NEUTRAL_RAMPS.warm.dark.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a light tenant's red alone, since it already clears 6.1:1", () => {
    expect(style(branding({ brandNeutral: "warm", brandMode: "light" }))["--form-error"])
      .toBe("#b91c1c");
  });

  it("emits none for an unthemed form or a transparent embed", () => {
    // Both render on a surface this module does not own — the browser canvas
    // or the host page — where form.css's literal is the honest answer.
    expect(publicFormTheme(NONE, false).style).not.toHaveProperty("--form-error");
    expect(publicFormTheme(branding({ brandNeutral: "warm", brandMode: "dark" }), true).style)
      .not.toHaveProperty("--form-error");
  });
});

describe("serializeDeclarations", () => {
  it("emits every safe pair as an important declaration", () => {
    expect(serializeDeclarations({ "--background": "#12100e", "--radius": "1rem" }))
      .toBe("--background:#12100e !important;--radius:1rem !important;");
  });

  it("drops a key that is not a plain custom property", () => {
    for (const key of ["background", "--Background", "--x;color", "--x)", ""]) {
      expect(serializeDeclarations({ [key]: "#12100e" }), key).toBe("");
    }
  });

  it("drops a value outside the charset, so a smuggled declaration cannot print", () => {
    for (const value of [
      "#12100e;position:fixed", "url(https://evil.example/x.png) ;", "expression(alert(1))!",
      'red"', "#12100E",
    ]) {
      expect(serializeDeclarations({ "--background": value }), value).toBe("");
    }
  });
});

// Two copies of one value in two languages — the module's answers and the
// stylesheet's own fallbacks — with nothing crossing between them is exactly
// how brand_type stayed inert through M4a. This is what crosses.
describe("form.css fallbacks match the module's unthemed answers", () => {
  const css = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/f/[publicId]/form.css"),
    "utf8",
  );

  it.each(Object.entries(FORM_CSS_FALLBACKS))(
    "%s falls back to the literal this page rendered before the theme existed", (token, expected) => {
      const uses = [...css.matchAll(new RegExp(`var\\(${token},\\s*([^)]+)\\)`, "g"))]
        .map((m) => m[1]!.trim());
      expect(uses.length, `${token} is never read in form.css`).toBeGreaterThan(0);
      for (const used of uses) expect(used).toBe(expected);
    },
  );

  // The `.dark` block is gone on purpose: the dark token set carries the mode
  // itself, so a second set of literals here would be one more thing to keep
  // in step — and it would have outranked nothing, since it keyed on a class
  // this route no longer emits.
  it("keeps no .dark block of its own", () => {
    expect(css).not.toMatch(/\.dark\s/);
  });
});
