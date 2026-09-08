import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Branding } from "@bis/db";
import { contrastRatio, FORM_ACCENT_FALLBACK } from "./color";
import { NEUTRAL_RAMPS } from "./neutral-ramps";
import {
  FORM_CSS_FALLBACKS, publicFormTheme, parseHostMode, serializeDeclarations,
} from "./public-form-theme";
import { deriveTheme } from "./theme";
import { themeInputsFrom } from "./tenant-theme";
import { themeStyle } from "./theme-style";

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

  // serializeDeclarations documents an invariant — "nothing reachable through
  // publicFormTheme can produce a key or value that fails it". That was FALSE
  // for one commit: SAFE_KEY refused a digit (`--accent-2`, `--sidebar-tint-2`,
  // `--accent-2-dim`, `--ring-glow-2`) and SAFE_VALUE refused `%` (all four
  // color-mix tints), so the whole accent family vanished from the dark rule
  // while the inline LIGHT style kept it — a follow tenant on a dark device
  // painted the light accents. The invariant is pinned here rather than
  // claimed in a comment: everything themeStyle emits must survive the guard.
  it("nothing reachable fails the guard: the dark rule carries every declaration themeStyle emits", () => {
    const b = branding({ brandNeutral: "warm", brandMode: "follow", brandColor: "#1e3a8a" });
    const css = publicFormTheme(b, false).darkCss!;
    // The set the module itself builds for the dark half, by the same route.
    const emitted = Object.entries(
      themeStyle(deriveTheme(themeInputsFrom(b), "dark")!) as unknown as Record<string, string>,
    );
    expect(emitted.length).toBeGreaterThan(10);
    for (const [key, value] of emitted) {
      expect(css, `${key}:${value}`).toContain(`${key}:${value} !important;`);
    }

    // The dark rule also carries the CTA and error tokens -- built by
    // resolveCta(...) and errorStyle(...) (public-form-theme.ts, around the
    // darkRule(serializeDeclarations({...})) call), neither of which is
    // exported (both are private to this module), so this cannot
    // independently recompute their expected values the way the loop above
    // does for themeStyle's output. What IS pinned: none of the three keys
    // can silently vanish from the dark rule with a malformed or missing
    // value -- which is exactly the shape of the F3 defect this whole
    // describe block exists to catch -- and --form-accent's value is
    // cross-checked against a second, independent publicFormTheme call for
    // the same branding (a determinism/consistency check, not a correctness
    // oracle for resolveCta itself).
    for (const key of ["--form-accent", "--form-accent-foreground", "--form-error"]) {
      expect(css, key).toMatch(new RegExp(`${key}:#[0-9a-f]{6} !important;`));
    }
    const darkCta = css.match(/--form-accent:(#[0-9a-f]{6})/)![1]!;
    expect(darkCta).toBe(publicFormTheme(b, false).darkCss!.match(/--form-accent:(#[0-9a-f]{6})/)![1]!);
  });

  // The tint alphas are per mode (.09 light, .14 dark), so the dark rule's
  // --accent-dim is not the inline light one — which is also the only way a
  // reader can see the rule is carrying its own answer rather than none.
  it("carries its own --accent-dim, not the inline light one", () => {
    const b = branding({ brandNeutral: "warm", brandMode: "follow", brandColor: "#1e3a8a" });
    const css = publicFormTheme(b, false).darkCss!;
    const darkDim = css.match(/--accent-dim:([^;]*) !important;/)![1]!;
    expect(darkDim).not.toBe(style(b)["--accent-dim"]);
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

  // The two characters the accent family needs and the old guards refused: a
  // DIGIT in the key and a `%` in the value. Both are inert — neither can end
  // a declaration or a block — and dropping them is what emptied a follow
  // tenant's dark rule of its accents.
  it("emits a key with a digit and a value with a percentage", () => {
    expect(serializeDeclarations({ "--accent-2": "#4fd8e6" }))
      .toBe("--accent-2:#4fd8e6 !important;");
    expect(serializeDeclarations({ "--accent-dim": "color-mix(in srgb, #1e3a8a 14%, transparent)" }))
      .toBe("--accent-dim:color-mix(in srgb, #1e3a8a 14%, transparent) !important;");
  });

  // Widening the charset must not widen what it defends against: `;`, `{`,
  // `}` and `:` are the characters that end a declaration or a block, and
  // none of them was admitted.
  it("still drops a smuggled declaration that rides in behind a digit or a percentage", () => {
    for (const value of ["14%;position:fixed", "#12100e}body{color:red", "--x:1"]) {
      expect(serializeDeclarations({ "--accent-dim": value }), value).toBe("");
    }
    expect(serializeDeclarations({ "--x;color": "14%" })).toBe("");
  });
});

// Two copies of one value in two languages — the module's answers and the
// stylesheet's own fallbacks — with nothing crossing between them is exactly
// how brand_type stayed inert through M4a. This is what crosses.
describe("form.css fallbacks match the module's unthemed answers", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");
  const formCss = read("../../app/f/[publicId]/form.css");
  // P7 moved the brand header's rules — and with them their `--foreground`
  // and `--font-sans` fallbacks — out of form.css into the shared
  // public-brand.css that /b and the cancel page also read. Both files are
  // checked, but SEPARATELY: concatenating them would let a token deleted
  // from form.css still satisfy the "is read at all" check because the other
  // file happens to read it, which is how `.bis-form`'s own colour could go
  // missing and a dark tenant's form render UA-black on green tests.
  const brandCss = read("../../styles/public-brand.css");
  const css = formCss;

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

  // The shared brand stylesheet, checked on its own terms: it reads only the
  // handful of tokens the header needs, so "every token appears" is the wrong
  // assertion for it. What must hold is that whatever it DOES read falls back
  // to the same literal form.css would have — the two files render the same
  // unthemed page, and a third copy of these values is exactly the drift this
  // block exists to prevent.
  it("public-brand.css reads at least one token, and every fallback it uses matches", () => {
    let found = 0;
    for (const [token, expected] of Object.entries(FORM_CSS_FALLBACKS)) {
      const uses = [...brandCss.matchAll(new RegExp(`var\\(${token},\\s*([^)]+)\\)`, "g"))]
        .map((m) => m[1]!.trim());
      found += uses.length;
      for (const used of uses) expect(used, token).toBe(expected);
    }
    // Guards the loop above from passing vacuously if the file is ever
    // rewritten to hard-code its values instead of reading tokens.
    expect(found, "public-brand.css reads no theme tokens at all").toBeGreaterThan(0);
  });
});

describe("publicFormTheme — the host page's own mode (`?theme=`)", () => {
  const dark = (b: Branding, transparent = false) =>
    publicFormTheme(b, transparent, "dark").style as unknown as Record<string, string>;

  it("engages the default ramp's dark set for an unthemed account when the host says dark", () => {
    const result = publicFormTheme(NONE, false, "dark");
    expect(result.themed).toBe(true);
    expect(result.darkCss).toBeNull();
    expect(dark(NONE)["--background"]).toBe(NEUTRAL_RAMPS.slate.dark.bg);
    expect(dark(NONE)["--foreground"]).toBe(NEUTRAL_RAMPS.slate.dark.fg);
    expect((result.style as { colorScheme?: string }).colorScheme).toBe("dark");
  });

  it("stands in for a follow tenant's media rule: the host already knows the answer", () => {
    const b = branding({ brandNeutral: "warm", brandMode: "follow" });
    const result = publicFormTheme(b, false, "dark");
    expect(result.darkCss).toBeNull();
    expect(dark(b)["--background"]).toBe(NEUTRAL_RAMPS.warm.dark.bg);
    // And the other way: a follow tenant on a light host paints light, no rule.
    const light = publicFormTheme(b, false, "light");
    expect(light.darkCss).toBeNull();
    expect((light.style as Record<string, string>)["--background"]).toBe(NEUTRAL_RAMPS.warm.light.bg);
  });

  it("never overrides a mode the operator fixed", () => {
    const b = branding({ brandNeutral: "cool", brandMode: "light" });
    expect(dark(b)["--background"]).toBe(NEUTRAL_RAMPS.cool.light.bg);
    const fixedDark = branding({ brandNeutral: "cool", brandMode: "dark" });
    const onLightHost = publicFormTheme(fixedDark, false, "light").style as unknown as Record<string, string>;
    expect(onLightHost["--background"]).toBe(NEUTRAL_RAMPS.cool.dark.bg);
  });

  it("gives a transparent embed the hinted mode's text and input tokens, but still no backdrop", () => {
    const b = branding({ brandCorners: "round" });
    const result = publicFormTheme(b, true, "dark");
    const s = result.style as unknown as Record<string, string>;
    expect(result.themed).toBe(true);
    expect(result.darkCss).toBeNull();
    expect(s).not.toHaveProperty("--background");
    expect(s["--foreground"]).toBe(NEUTRAL_RAMPS.slate.dark.fg);
    expect(s["--card"]).toBe(NEUTRAL_RAMPS.slate.dark.card);
    expect(s["--border"]).toBe(NEUTRAL_RAMPS.slate.dark.border);
    expect(s["--muted-foreground"]).toBe(NEUTRAL_RAMPS.slate.dark.mutedFg);
    expect(s["--form-error"]).toBeDefined();
    expect((result.style as { colorScheme?: string }).colorScheme).toBe("dark");
    // The CTA is measured against the dark surfaces it will actually sit on.
    expect(contrastRatio(result.formAccent.accent, NEUTRAL_RAMPS.slate.dark.bg)).toBeGreaterThanOrEqual(3);
  });

  it("leaves a transparent embed on a fixed-mode tenant exactly as before when the host disagrees", () => {
    const b = branding({ brandMode: "light" });
    const s = publicFormTheme(b, true, "dark").style as unknown as Record<string, string>;
    expect(Object.keys(s).sort()).toEqual(["--font-sans", "--form-accent", "--form-accent-foreground", "--radius"]);
  });

  it("no hint changes nothing: the third argument defaults to null", () => {
    expect(publicFormTheme(NONE, false)).toEqual(publicFormTheme(NONE, false, null));
    const b = branding({ brandNeutral: "warm", brandMode: "follow" });
    expect(publicFormTheme(b, false)).toEqual(publicFormTheme(b, false, null));
  });
});

describe("parseHostMode", () => {
  it("accepts only the two words", () => {
    expect(parseHostMode("light")).toBe("light");
    expect(parseHostMode("dark")).toBe("dark");
    for (const junk of ["auto", "Dark", "", undefined, null, "follow"]) {
      expect(parseHostMode(junk), String(junk)).toBeNull();
    }
  });
});
