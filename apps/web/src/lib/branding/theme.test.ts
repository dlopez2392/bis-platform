import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Branding } from "@bis/db";
import { contrastRatio } from "./color";
import { publicFormTheme } from "./public-form-theme";
import { NEUTRAL_RAMPS, SIDEBAR_FOREGROUND, type NeutralName } from "./neutral-ramps";
import { deriveTheme, parseAllowlisted, NEUTRAL_NAMES, BIS, FONT, type CornerName, type TypeName } from "./theme";
import { FONT_ALLOWLIST, SAFE_STYLE_FALLBACKS } from "./theme-style";

const NEUTRALS: NeutralName[] = ["warm", "cool", "slate"];
const CORNERS: CornerName[] = ["sharp", "soft", "round"];
const TYPES: TypeName[] = ["geist", "inter", "serif"];
const MODES = ["light", "dark"] as const;

// Black and white are the interesting ones: an achromatic input can only move
// along lightness, and white has to DARKEN on a light background while black
// has to lighten. A one-directional walk passes the rest and fails these two.
//
// #8b5cf6 and #068d1a are the dead luminance band (~0.183-0.200 relative
// luminance): each clears 3:1 against a white card on its own, so a
// derivation that only lifted for visibility (the pre-fix `ensureContrast`
// path) would pass them straight through — and then fail on-primary here,
// since neither white (4.46:1 / measured similarly for the green) nor
// #111111 reaches 4.5:1 on either one. #8b5cf6 is the exact hex this bug was
// found through (also globals.css's OLD, since-fixed, hardcoded dark
// --primary — see BIS.dark's comment in theme.ts).
// #cc986c is the worst case measured before primary was lifted against BOTH
// card and background: on the light `cool` ramp it cleared 3:1 on the card
// alone but landed at only 2.84:1 against the page background — a button
// the old single-surface lift would have shipped. Kept alongside the
// dead-luminance-band entries above, which cover a different failure mode
// (visible but unable to carry either label).
const ADVERSARIAL = [
  null, "#000000", "#ffffff", "#fde047", "#808080", "#1e3a8a", "#6d28d9",
  "#8b5cf6", "#068d1a", "#cc986c",
];

describe("deriveTheme", () => {
  it("returns null when nothing is set, so today's rendering is untouched", () => {
    expect(deriveTheme(
      { color: null, neutral: null, corners: null, type: null, mode: null }, "light",
    )).toBeNull();
  });

  // PR #10 shipped brand_color as accents-only. An agency that set just a
  // colour must not find its clients' chrome repainted by a deploy.
  it("returns null for a colour with no other input", () => {
    expect(deriveTheme(
      { color: "#1e3a8a", neutral: null, corners: null, type: null, mode: null }, "light",
    )).toBeNull();
  });

  it("engages as soon as one of the four new inputs is set", () => {
    const t = deriveTheme(
      { color: null, neutral: "warm", corners: null, type: null, mode: null }, "light",
    );
    expect(t?.background).toBe(NEUTRAL_RAMPS.warm.light.bg);
  });

  // The gate above was only ever exercised through `neutral`. Each of the
  // other three flags has to engage the theme on its own too, or a tenant
  // that sets only corners/type/mode would silently see no changes at all.
  it("engages via corners alone", () => {
    const t = deriveTheme(
      { color: null, neutral: null, corners: "sharp", type: null, mode: null }, "light",
    );
    expect(t).not.toBeNull();
    expect(t?.radius).toBe("0.125rem");
  });

  it("engages via type alone", () => {
    const t = deriveTheme(
      { color: null, neutral: null, corners: null, type: "inter", mode: null }, "light",
    );
    expect(t).not.toBeNull();
    expect(t?.fontSans).toBe("var(--font-inter)");
  });

  it("engages via mode alone", () => {
    const t = deriveTheme(
      { color: null, neutral: null, corners: null, type: null, mode: "dark" }, "light",
    );
    expect(t).not.toBeNull();
    // mode's only job here is to open the gate — neutral/corners/type still
    // fall back to their defaults since none of them was set.
    expect(t?.background).toBe(NEUTRAL_RAMPS.slate.light.bg);
  });

  it("keeps the sidebar dark in light mode", () => {
    const light = deriveTheme(
      { color: null, neutral: "slate", corners: null, type: null, mode: null }, "light",
    );
    const dark = deriveTheme(
      { color: null, neutral: "slate", corners: null, type: null, mode: null }, "dark",
    );
    expect(light?.sidebar).toBe(NEUTRAL_RAMPS.slate.sidebar);
    expect(dark?.sidebar).toBe(NEUTRAL_RAMPS.slate.sidebar);
  });

  it("maps corners to concrete lengths", () => {
    const of = (corners: CornerName) => deriveTheme(
      { color: null, neutral: "slate", corners, type: null, mode: null }, "light",
    )?.radius;
    expect(of("sharp")).toBe("0.125rem");
    expect(of("soft")).toBe("0.625rem");
    expect(of("round")).toBe("1rem");
  });

  it("maps type to a font variable from a closed set", () => {
    const of = (type: TypeName) => deriveTheme(
      { color: null, neutral: "slate", corners: null, type, mode: null }, "light",
    )?.fontSans;
    expect(of("geist")).toBe("var(--font-geist-sans)");
    expect(of("inter")).toBe("var(--font-inter)");
    expect(of("serif")).toBe("var(--font-source-serif)");
  });

  it("ignores a colour that is not a real hex", () => {
    const t = deriveTheme(
      { color: "red; position:fixed", neutral: "slate", corners: null, type: null, mode: null },
      "light",
    );
    expect(t?.primary).toBe("#6d28d9"); // the BIS light default, not the input
  });

  // The whole point of the milestone: no combination of stored inputs can
  // produce an illegible screen.
  it("clears every contrast threshold for every combination", () => {
    for (const neutral of NEUTRALS)
      for (const corners of CORNERS)
        for (const type of TYPES)
          for (const mode of MODES)
            for (const color of ADVERSARIAL) {
              const t = deriveTheme({ color, neutral, corners, type, mode: null }, mode)!;
              const where = `${neutral}/${corners}/${type}/${mode}/${color}`;

              // text
              expect(contrastRatio(t.foreground, t.background), `fg on bg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.cardForeground, t.card), `card fg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.mutedForeground, t.background), `muted on bg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.mutedForeground, t.card), `muted on card ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.secondaryForeground, t.secondary), `secondary ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.primaryForeground, t.primary), `on primary ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.accentForeground, t.accent), `on accent ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.sidebarForeground, t.sidebar), `sidebar text ${where}`).toBeGreaterThanOrEqual(4.5);

              // primary as text: text-primary links and the `link`
              // Button/Badge variants render it directly on BOTH the card
              // and the page background, so both are held to the 4.5:1 text
              // floor — not 3:1, which is exactly what let a 2.84:1 button
              // (#cc986c on the light `cool` background) through undetected
              // before this fix.
              expect(contrastRatio(t.primary, t.card), `primary on card ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.primary, t.background), `primary on bg ${where}`).toBeGreaterThanOrEqual(4.5);

              // non-text UI
              expect(contrastRatio(t.ring, t.background), `ring on bg ${where}`).toBeGreaterThanOrEqual(3);
              expect(contrastRatio(t.ring, t.card), `ring on card ${where}`).toBeGreaterThanOrEqual(3);
              expect(contrastRatio(t.sidebarAccent, t.sidebar), `sidebar accent ${where}`).toBeGreaterThanOrEqual(3);

              // accent is the hover/focus surface for dropdown items, command
              // results and ghost buttons — not an accent stripe — so it is
              // deliberately the ramp's own quiet pair and never brand-derived.
              // `> 1` would pass for any two colours that merely differ, which
              // proves nothing, so pin the actual contract instead: accent IS
              // the ramp's subtle step, its text IS the ramp's foreground, and
              // that pair still has to be readable.
              const steps = NEUTRAL_RAMPS[neutral][mode];
              expect(t.accent, `accent is the ramp's subtle step ${where}`).toBe(steps.subtle);
              expect(t.accentForeground, `accent text is the ramp's fg ${where}`).toBe(steps.fg);
              expect(contrastRatio(t.accentForeground, t.accent), `on accent ${where}`)
                .toBeGreaterThanOrEqual(4.5);
              // A hover fill nobody can see is a hover that does not exist.
              // Not 3:1 — a quiet surface is meant to be quiet — but it must
              // not collapse into the surface it appears over.
              expect(contrastRatio(t.accent, t.card), `accent distinguishable from card ${where}`)
                .toBeGreaterThanOrEqual(1.04);

              // hierarchy: muted text must stay quieter than primary text
              expect(contrastRatio(t.mutedForeground, t.background), `muted quieter ${where}`)
                .toBeLessThan(contrastRatio(t.foreground, t.background));
            }
  });
});

// The public form joins the sweep rather than getting a private one of its
// own. It is the only surface a client's own CUSTOMERS see, it paints the
// same derived tokens, and this sweep is what found two AA defects that were
// live in production — a per-file version of it would be the copy that drifts.
describe("the public form clears its thresholds for every combination", () => {
  const row = (over: Partial<Branding>): Branding => ({
    brandName: null, brandLogoPath: null, brandColor: null,
    brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
    replyToEmail: null,
    ...over,
  });

  it("keeps the CTA, its label and the body text legible everywhere", () => {
    for (const neutral of NEUTRALS)
      for (const corners of CORNERS)
        for (const type of TYPES)
          for (const mode of MODES)
            for (const color of ADVERSARIAL) {
              const { style, formAccent } = publicFormTheme(row({
                brandNeutral: neutral, brandCorners: corners, brandType: type,
                brandMode: mode, brandColor: color,
              }), false);
              const s = style as unknown as Record<string, string>;
              const where = `${neutral}/${corners}/${type}/${mode}/${color}`;

              // The CTA is two things wearing one colour: the Submit fill on
              // the page and the focus outline on an input filled with --card.
              // 3:1 is WCAG 1.4.11 for a non-text UI component.
              expect(contrastRatio(formAccent.accent, s["--background"]!), `cta on bg ${where}`)
                .toBeGreaterThanOrEqual(3);
              expect(contrastRatio(formAccent.accent, s["--card"]!), `cta outline on input ${where}`)
                .toBeGreaterThanOrEqual(3);
              expect(contrastRatio(formAccent.accentForeground, formAccent.accent), `cta label ${where}`)
                .toBeGreaterThanOrEqual(4.5);

              // Asserted through the tokens the FORM actually emits, not
              // through deriveTheme's return value: the question here is
              // whether the values that reach this page's style attribute are
              // legible, which is a different question from whether the
              // derivation computed legible ones.
              expect(contrastRatio(s["--foreground"]!, s["--background"]!), `body text ${where}`)
                .toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(s["--muted-foreground"]!, s["--background"]!), `optional label ${where}`)
                .toBeGreaterThanOrEqual(4.5);

              // The message under a field that says the address is wrong.
              // form.css's own red is 2.93:1 on every dark ramp, which is what
              // this sweep caught — brand_mode is what made it reachable.
              expect(contrastRatio(s["--form-error"]!, s["--background"]!), `error text ${where}`)
                .toBeGreaterThanOrEqual(4.5);

              // 🔴 RECORDED, NOT MET: WCAG 1.4.11 asks 3:1 for an input's
              // visual boundary and NOTHING in this product reaches it — the
              // ramps' border/card lands at 1.29–1.36:1 and the literal this
              // form used before the theme (#d4d4d8 on #ffffff) at 1.478:1.
              // Asserting 3:1 here would fail every combination and would be
              // a change to the shared ramps, i.e. to the whole dashboard,
              // which M4b does not own. The floor asserted is the one that
              // holds: the border must not collapse into the fill. Raising it
              // is a design-system item, not a form item.
              expect(contrastRatio(s["--border"]!, s["--card"]!), `input boundary visible ${where}`)
                .toBeGreaterThanOrEqual(1.25);
            }
  });

  it("emits the same CTA the dark rule would, for a follow tenant in dark", () => {
    // The pairs above are checked per fixed mode. `follow` carries a second,
    // separately-derived set in a media rule, and nothing else would notice
    // if that set were computed against the wrong surfaces.
    for (const neutral of NEUTRALS)
      for (const color of ADVERSARIAL) {
        const css = publicFormTheme(row({
          brandNeutral: neutral, brandMode: "follow", brandColor: color,
        }), false).darkCss!;
        const cta = css.match(/--form-accent:(#[0-9a-f]{6})/)![1]!;
        const label = css.match(/--form-accent-foreground:(#[0-9a-f]{6})/)![1]!;
        const error = css.match(/--form-error:(#[0-9a-f]{6})/)![1]!;
        const where = `${neutral}/follow/${color}`;
        expect(contrastRatio(error, NEUTRAL_RAMPS[neutral].dark.bg), `dark error text ${where}`)
          .toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(cta, NEUTRAL_RAMPS[neutral].dark.bg), `dark cta on bg ${where}`)
          .toBeGreaterThanOrEqual(3);
        expect(contrastRatio(cta, NEUTRAL_RAMPS[neutral].dark.card), `dark cta on input ${where}`)
          .toBeGreaterThanOrEqual(3);
        expect(contrastRatio(label, cta), `dark cta label ${where}`).toBeGreaterThanOrEqual(4.5);
      }
  });
});

// The Settings action's own gate before a value reaches setBranding: blank
// clears the field, a member of the closed set passes through, anything else
// is rejected so a typo returns a message instead of a Postgres constraint
// violation. Exercised here directly because the action itself can only be
// driven through FormData inside a "use server" module.
describe("parseAllowlisted", () => {
  it("treats an empty string as clearing the input", () => {
    expect(parseAllowlisted("", NEUTRAL_NAMES)).toBeNull();
  });

  it("trims before deciding, so an empty selection never becomes a stray string", () => {
    expect(parseAllowlisted("   ", NEUTRAL_NAMES)).toBeNull();
  });

  it("passes through a member of the allowed set", () => {
    expect(parseAllowlisted("warm", NEUTRAL_NAMES)).toBe("warm");
  });

  it("trims surrounding whitespace off an otherwise valid value", () => {
    expect(parseAllowlisted("  cool  ", NEUTRAL_NAMES)).toBe("cool");
  });

  it("rejects anything outside the closed set", () => {
    expect(parseAllowlisted("mauve", NEUTRAL_NAMES)).toBe(false);
  });

  it("is case-sensitive, so a mismatched case is rejected rather than silently normalized", () => {
    expect(parseAllowlisted("WARM", NEUTRAL_NAMES)).toBe(false);
  });
});

// BIS.dark.primary and BIS.dark.ring must stay equal to the color the app
// actually paints — theme.ts's own comment says so, but a comment enforces
// nothing. Since Phase 1's semantic cut-over, globals.css's `--primary`/
// `--ring` are `var(--accent)`, not a literal, so the hex truth those two
// track lives in tokens.css's own `--accent` per mode. This reads BOTH live
// CSS files and checks them against the constants actually used at
// derivation time, so the two cannot drift apart again without a red test —
// following the truth to its new home rather than loosening what's checked.
describe("globals.css / tokens.css / BIS parity", () => {
  const cssPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../app/(dashboard)/globals.css",
  );
  const css = readFileSync(cssPath, "utf8");
  const darkBlock = css.match(/\.dark\s*\{([^}]*)\}/)?.[1];
  const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1];

  const tokensPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../styles/tokens.css",
  );
  const tokensCss = readFileSync(tokensPath, "utf8");
  const tokensRootBlock = tokensCss.match(/:root\s*\{([^}]*)\}/)?.[1];
  const tokensDarkBlock = tokensCss.match(/\.dark\s*\{([^}]*)\}/)?.[1];

  const declared = (block: string | undefined, token: string) =>
    block?.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6});`))?.[1]?.toLowerCase();

  it("finds the .dark block", () => {
    expect(darkBlock).toBeTruthy();
  });

  it("finds the :root block", () => {
    expect(rootBlock).toBeTruthy();
  });

  it("finds tokens.css's :root and .dark blocks", () => {
    expect(tokensRootBlock).toBeTruthy();
    expect(tokensDarkBlock).toBeTruthy();
  });

  it("keeps BIS.dark.primary equal to tokens.css's dark --accent", () => {
    expect(BIS.dark.primary).toBe(declared(tokensDarkBlock, "accent"));
  });

  it("keeps BIS.dark.ring equal to tokens.css's dark --accent", () => {
    expect(BIS.dark.ring).toBe(declared(tokensDarkBlock, "accent"));
  });

  it("keeps BIS.light.primary equal to tokens.css's light --accent", () => {
    expect(BIS.light.primary).toBe(declared(tokensRootBlock, "accent"));
  });

  it("keeps BIS.light.ring equal to tokens.css's light --accent", () => {
    expect(BIS.light.ring).toBe(declared(tokensRootBlock, "accent"));
  });

  // globals.css itself still has to confirm --primary/--ring actually route
  // through --accent (not some other token) in both blocks — a regression
  // that repointed the var() at the wrong name would slip past the
  // tokens.css-only checks above, which never look at globals.css's wiring.
  it("keeps :root --primary and --ring wired to var(--accent)", () => {
    expect(rootBlock).toMatch(/--primary:\s*var\(--accent\);/);
    expect(rootBlock).toMatch(/--ring:\s*var\(--accent\);/);
  });

  it("keeps .dark --primary wired to var(--accent)", () => {
    expect(darkBlock).toMatch(/--primary:\s*var\(--accent\);/);
  });

  // sidebar-accent is a sanctioned literal (the sidebar-literal island), not
  // tokenized, so its hex truth still lives directly in globals.css.
  it("keeps :root --sidebar-accent equal to its BIS.light constant", () => {
    expect(declared(rootBlock, "sidebar-accent")).toBe(BIS.light.sidebarAccent);
  });

  it("keeps .dark --sidebar-accent equal to BIS.dark.sidebarAccent", () => {
    expect(declared(darkBlock, "sidebar-accent")).toBe(BIS.dark.sidebarAccent);
  });

  // SIDEBAR_FOREGROUND is deliberately mode-independent, so BOTH blocks must
  // agree with the one constant — the sidebar does not invert. Also a
  // sanctioned literal, so this still reads globals.css directly.
  it("keeps --sidebar-foreground equal to SIDEBAR_FOREGROUND in both modes", () => {
    expect(declared(rootBlock, "sidebar-foreground")).toBe(SIDEBAR_FOREGROUND);
    expect(declared(darkBlock, "sidebar-foreground")).toBe(SIDEBAR_FOREGROUND);
  });

  // themeStyle falls back to these when a value fails validation. --background
  // is now `var(--surface-0)` in globals.css, so its light default's hex
  // truth reads from tokens.css; --radius stays a literal directly in
  // globals.css (controls converge in P2), so that half still reads there.
  it("keeps themeStyle's validation fallbacks equal to the light defaults", () => {
    expect(SAFE_STYLE_FALLBACKS.color).toBe(declared(tokensRootBlock, "surface-0"));
    const radius = rootBlock?.match(/--radius:\s*([0-9.]+rem);/)?.[1];
    expect(radius).toBe(SAFE_STYLE_FALLBACKS.radius);
  });

  // Same reason as the --primary/--ring wiring checks above: the tokens.css
  // comparison alone doesn't catch a typo that repoints globals' --background
  // at the wrong surface step (e.g. --surface-1) while still matching some
  // OTHER token's hex by coincidence. Pin the actual wiring in globals.css.
  it("keeps :root --background wired to var(--surface-0)", () => {
    expect(rootBlock).toMatch(/--background:\s*var\(--surface-0\);/);
  });

  // shadcn's --accent name is repointed at the hover surface, not the brand
  // accent (see the NOTE in the design brief) — globals.css deletes
  // --accent/--accent-foreground from :root/.dark entirely and instead maps
  // @theme inline's --color-accent/-foreground straight at the surface
  // ladder, so this asserts the new architecture's actual invariant instead
  // of a literal that no longer exists.
  it("wires shadcn's --color-accent to the hover surface, not the brand accent", () => {
    expect(css).toMatch(/--color-accent:\s*var\(--surface-3\);/);
    expect(css).toMatch(/--color-accent-foreground:\s*var\(--text-1\);/);
  });
});

// Three hand-kept lists that must name the same four font variables: the
// derivation's FONT map, the allowlist themeStyle validates against, and the
// `variable:` names the root layout hands next/font. A typo in any one of them
// makes a tenant's typeface silently fall back with no error anywhere — which
// is close to how brand_type managed to be inert for the whole milestone.
describe("font variable names agree across the three places that hold them", () => {
  const read = (relative: string) => readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), relative), "utf8",
  );
  // BOTH root layouts. `app/f` is a separate tree with its own <html> and
  // never sees the dashboard's font declarations, so a face declared in one
  // and not the other resolves to nothing on that route and the tenant's
  // typeface falls back with no error anywhere — which is close to how
  // brand_type managed to be inert for the whole of M4a.
  const layouts = {
    dashboard: read("../../app/(dashboard)/layout.tsx"),
    publicForm: read("../../app/f/layout.tsx"),
  };

  it.each(
    Object.entries(FONT).flatMap(([name, value]) =>
      Object.entries(layouts).map(([where, source]) => [name, where, value, source] as const)),
  )("%s resolves to a variable the %s root layout declares", (_name, _where, value, source) => {
    const varName = value.match(/var\((--[a-z-]+)\)/)?.[1];
    expect(varName, `FONT value ${value} is not a var() reference`).toBeTruthy();
    expect(source).toContain(`variable: "${varName}"`);
  });

  it("allows exactly the values FONT can produce", () => {
    expect([...FONT_ALLOWLIST].sort()).toEqual(Object.values(FONT).sort());
  });
});
