/**
 * The tenant theme, resolved for the one surface a client's own customers see.
 *
 * The workspace paints its token set on `<body>` from the root layout. This
 * route cannot reuse that code path — `app/f` is a separate root layout with
 * no globals.css, no next-themes and no cookie — so this module answers the
 * same question for `/f/<publicId>`: which tokens, in which mode, and what
 * fill the Submit button gets.
 *
 * Pure and I/O-free, and free of any runtime `@bis/db` import (`Branding`
 * crosses as a type only), for the same reasons `tenant-theme.ts` is. It
 * composes the existing pieces rather than adding a second mapping: the same
 * `themeInputsFrom`, the same `deriveTheme`, the same validated `themeStyle`
 * emitter, so every value the form paints has passed the guards the workspace
 * passes.
 */
import type { CSSProperties } from "react";
import type { Branding } from "@bis/db";
import { ensureContrast, FORM_ACCENT_FALLBACK, parseHexColor, readableTextOn } from "./color";
import { deriveTheme, liftForLabel, type ResolvedTheme } from "./theme";
import { themeInputsFrom } from "./tenant-theme";
import { themeStyle } from "./theme-style";

/**
 * WCAG 1.4.11: the Submit fill is a non-text UI component, so its boundary
 * needs 3:1 against what it sits on. Not 4.5:1 and not `--primary`:
 * `deriveTheme` lifts primary to the 4.5:1 TEXT floor because it doubles as
 * 12px link text, and using that value here would visibly walk a client's
 * button off the colour they picked for a threshold this element does not owe.
 */
const CTA_MIN_RATIO = 3;

/**
 * What the CTA is measured against when there is no token set to sit on: an
 * unthemed form, or a transparent embed whose backdrop belongs to the host
 * page and is therefore unknowable. White is the overwhelming default, and it
 * is the surface every form on this route has actually had until now.
 */
const UNTHEMED_SURFACE = "#ffffff";

/**
 * The validation red `form.css` has always used, and the reason it needs a
 * token at all now.
 *
 * It is 6.1:1 on a light page and **2.93:1 on all three dark ramps** — under
 * AA for text, on the sentence that tells a customer their email address is
 * wrong. It was unreachable before M4b because this page was always light in
 * practice (the old `.dark` block recoloured the text and the inputs and
 * never the page, and no editor control could set it anyway). `brand_mode`
 * makes it reachable, so the value is lifted per mode rather than left as a
 * literal the theme cannot see. Found by the contrast sweep, not by review.
 */
const FORM_ERROR = "#b91c1c";

/**
 * The literals `form.css` keeps as its own `var(--token, …)` fallbacks, so an
 * unthemed form renders exactly as it did before this module existed.
 *
 * They live here as well as in the stylesheet because two copies of a value
 * in two languages is precisely how `brand_type` stayed inert for the whole
 * of M4a: nothing crossed between the TypeScript and the CSS, so nothing
 * could go red. `public-form-theme.test.ts` reads form.css and pins every one
 * of these.
 */
export const FORM_CSS_FALLBACKS = {
  // Not a value this page used to hardcode — `<main>` painted nothing at all
  // before M4b. It is pinned for the opposite reason: an unthemed form and a
  // transparent embed must both keep showing the canvas or the host page
  // through it, and a literal colour landing here is exactly how a
  // transparent embed would quietly stop being transparent.
  "--background": "transparent",
  "--font-sans": 'system-ui, -apple-system, "Segoe UI", sans-serif',
  "--foreground": "#18181b",
  "--card": "#ffffff",
  "--border": "#d4d4d8",
  "--muted-foreground": "#71717a",
  "--radius": "0.5rem",
  "--form-accent": FORM_ACCENT_FALLBACK,
  "--form-accent-foreground": "#ffffff",
  // Unthemed and transparent forms never emit this one: 6.1:1 on a light page
  // is fine, and a transparent embed's backdrop is the host page's business.
  "--form-error": "#b91c1c",
} as const;

export type FormAccent = { accent: string; accentForeground: string };

/**
 * The host page's own colour mode, when it says so: `?theme=light|dark` on
 * `/f` and `/b`, which `embed.js` forwards from a `data-theme` attribute.
 *
 * `brand_mode: "follow"` answers "which mode?" with `prefers-color-scheme`,
 * and that is the wrong oracle for a host page that toggles its own dark
 * class: a visitor on a light device who flipped bis-rgv.com to dark got a
 * white form in the middle of a dark page. The host knows; the iframe cannot.
 *
 * A hint outranks `null` and `follow` — both mean nobody has fixed the mode —
 * and never an explicit `light`/`dark` the operator chose in the branding
 * panel. Anything that is not one of the two words is no hint at all.
 */
export type HostMode = "light" | "dark";

export function parseHostMode(value: string | null | undefined): HostMode | null {
  return value === "light" || value === "dark" ? value : null;
}

export type PublicFormTheme = {
  /**
   * Custom properties for `<main>`. Never null: even an unthemed account
   * paints its brand colour on the CTA, which is what this route has always
   * done. What varies is whether the token set rides along with it.
   */
  style: CSSProperties;
  /**
   * A complete `@media (prefers-color-scheme: dark)` rule, or null when the
   * painted mode is fixed. The whole rule rather than its declarations: the
   * selector and the media condition then live beside the values they are
   * scoped to, and the unit tests assert the exact text that reaches the DOM.
   */
  darkCss: string | null;
  /** The CTA fill and its label, for the contrast sweep and for callers. */
  formAccent: FormAccent;
  /** Drives `data-tenant-theme`, the same attribute the workspace exposes. */
  themed: boolean;
};

/**
 * The CTA, lifted against both surfaces it lands on at once, and then far
 * enough that one of the two label colours is legible on it.
 *
 * It is two things wearing one colour: the Submit fill on the page
 * (`--background`) and the focus outline on an input filled with `--card`.
 * They are different colours in both modes, so clearing one is not clearing
 * the other — the same reason `deriveTheme` lifts its own `ring` twice.
 * One value used in both places, rather than two that could disagree.
 *
 * The label half is why this calls `liftForLabel` and not the bare
 * two-surface walk. A first version used the walk alone and the contrast
 * sweep caught `#8b5cf6` immediately: visible at 3:1 on white without moving
 * at all, and then carrying a 4.459:1 label — under AA, and exactly what
 * today's unlifted `resolveFormAccent` ships on that colour.
 *
 * `lastResort` is only reachable if neither direction can satisfy both parts,
 * which no ramp and no colour in the sweep does. Themed callers pass
 * `primary`, which `deriveTheme` has already guaranteed at 4.5:1 against both
 * of those exact surfaces AND for its own label — strictly stronger than what
 * is asked here.
 */
function resolveCta(
  brandColor: string | null, a: string, b: string, lastResort: string,
): FormAccent {
  const base = parseHexColor(brandColor) ?? FORM_ACCENT_FALLBACK;
  const accent = liftForLabel(base, a, b, CTA_MIN_RATIO) ?? lastResort;
  return { accent, accentForeground: readableTextOn(accent) };
}

/** `themeStyle`'s output, indexable. Every key is a custom property. */
function tokens(theme: ResolvedTheme): Record<string, string> {
  return themeStyle(theme) as unknown as Record<string, string>;
}

const ctaStyle = (cta: FormAccent) => ({
  "--form-accent": cta.accent,
  "--form-accent-foreground": cta.accentForeground,
});

/**
 * The error red, lifted to the 4.5:1 TEXT floor against the page it is read
 * on. Only the background, not the card: these messages sit under their field
 * on the page surface, never inside an input.
 *
 * Falls back to the foreground rather than to the literal — a message nobody
 * can read is worse than one that has lost its redness — which is the same
 * trade `deriveTheme` makes everywhere it cannot reach a threshold.
 */
const errorStyle = (theme: ResolvedTheme) => ({
  "--form-error": ensureContrast(FORM_ERROR, theme.background, 4.5) ?? theme.foreground,
});

// The one place on this route that emits CSS as TEXT rather than as a React
// style object, so it forfeits React's entity-escaping. Every value here has
// already passed themeStyle's validators (hex colours, a plain CSS length,
// three allowlisted var() references, color-mix() over an already-validated
// hex) or is a hex this module lifted itself, so nothing hostile should
// arrive — and these two patterns are the belt for the case where "should" is
// wrong. A key or value that fails is dropped, not printed.
//
// A DIGIT in the key and `%` in the value are admitted because the accent
// family needs both — `--accent-2`, `--sidebar-tint-2`, and the four
// `color-mix(in srgb, #xxxxxx 14%, transparent)` tints — and refusing them
// dropped that whole family from a `follow` tenant's dark rule while the
// inline light style kept it. Neither character widens what the guards
// defend against: `;`, `{`, `}` and `:` are what end a declaration or a
// block, and none of them is in either class.
const SAFE_KEY = /^--[a-z0-9-]+$/;
const SAFE_VALUE = /^[#a-z0-9(),.%\- ]+$/;

/**
 * `!important` on every declaration, and it is load-bearing rather than
 * defensive.
 *
 * The light token set is an inline `style` attribute on the same `<main>`
 * this rule selects, and an inline declaration outranks any author rule no
 * matter how specific or how the media query resolves. Without `!important`
 * the dark block would parse, match, and change nothing — a `follow` tenant
 * would silently paint light on a dark device, which is the exact shape of
 * failure `brand_type` had for the whole of M4a.
 *
 * Exported so its charset guard can be driven directly with the hostile values
 * nothing reachable through `publicFormTheme` should ever produce. That
 * "nothing reachable" is no longer only a claim: the `follow` cases above pin
 * that every declaration `themeStyle` emits survives this filter. It was false
 * for one commit — a digit in the key and a `%` in the value were both
 * refused — and the symptom was invisible from here, because the dropped
 * declarations were still present in the inline LIGHT style.
 */
export function serializeDeclarations(style: Record<string, string>): string {
  return Object.entries(style)
    .filter(([key, value]) =>
      typeof value === "string" && SAFE_KEY.test(key) && SAFE_VALUE.test(value))
    .map(([key, value]) => `${key}:${value} !important;`)
    .join("");
}

function darkRule(declarations: string): string {
  return `@media (prefers-color-scheme: dark){[data-tenant-theme]{${declarations}color-scheme:dark !important;}}`;
}

/**
 * `transparent` is the form's own `transparentBackground` setting, which means
 * "the host page owns the backdrop". A themed tenant still gets their colour,
 * corners and typeface there — but no surfaces and no mode, because painting
 * a dark card set onto an unknown host page is how a form disappears into it.
 */
export function publicFormTheme(
  branding: Branding, transparent: boolean, hostMode: HostMode | null = null,
): PublicFormTheme {
  const stored = themeInputsFrom(branding);
  // A hint stands in for a mode nobody fixed. Setting it here, on the inputs,
  // is what makes an otherwise unthemed account engage the theme for a host
  // that asked — the same rule as any other single control — so a dark host
  // page gets the default ramp's dark set rather than form.css's light
  // fallbacks painted onto it.
  const inputs = hostMode && (stored.mode === null || stored.mode === "follow")
    ? { ...stored, mode: hostMode }
    : stored;
  const light = deriveTheme(inputs, "light");

  // No theme controls set. The token set is absent entirely and form.css's own
  // fallbacks stand, so the page renders as it did before M4b — with the one
  // deliberate exception that the CTA is now lifted against the white it sits
  // on, which changes only those brand colours that could not be seen against
  // it. A brand colour alone never engages the theme, here or in the
  // workspace; that is deriveTheme's own rule and this route inherits it.
  if (!light) {
    const cta = resolveCta(inputs.color, UNTHEMED_SURFACE, UNTHEMED_SURFACE, FORM_ACCENT_FALLBACK);
    return { style: ctaStyle(cta) as CSSProperties, darkCss: null, formAccent: cta, themed: false };
  }

  if (transparent) {
    // A transparent embed on a host that named its mode: the backdrop is
    // still the host's, so `--background` stays out, but the text, input and
    // border tokens of THAT mode go in — dark labels on a dark host page are
    // what the hint exists to prevent. The CTA and the error red are measured
    // against the mode's own surfaces, the closest thing to the unknown
    // backdrop there is.
    if (hostMode && inputs.mode === hostMode) {
      const hinted = deriveTheme(inputs, hostMode)!;
      const cta = resolveCta(inputs.color, hinted.background, hinted.card, hinted.primary);
      const t = tokens(hinted);
      return {
        style: {
          "--foreground": t["--foreground"],
          "--card": t["--card"],
          "--border": t["--border"],
          "--muted-foreground": t["--muted-foreground"],
          "--radius": t["--radius"],
          "--font-sans": t["--font-sans"],
          ...ctaStyle(cta),
          ...errorStyle(hinted),
          colorScheme: hostMode,
        } as CSSProperties,
        darkCss: null,
        formAccent: cta,
        themed: true,
      };
    }

    const cta = resolveCta(inputs.color, UNTHEMED_SURFACE, UNTHEMED_SURFACE, FORM_ACCENT_FALLBACK);
    const t = tokens(light);
    return {
      // Corners and typeface only. Neither changes with mode, so there is
      // nothing a dark block could carry and darkCss stays null even for a
      // `follow` tenant.
      style: {
        "--radius": t["--radius"],
        "--font-sans": t["--font-sans"],
        ...ctaStyle(cta),
      } as CSSProperties,
      darkCss: null,
      formAccent: cta,
      themed: true,
    };
  }

  const dark = deriveTheme(inputs, "dark")!;
  const painted = inputs.mode === "dark" ? dark : light;
  const cta = resolveCta(inputs.color, painted.background, painted.card, painted.primary);

  // "follow" is the only mode that needs both sets: the visitor's own device
  // decides, and a setting that reads "follow the device" must not quietly
  // resolve to light on the one page the tenant does not control.
  const darkCss = inputs.mode === "follow"
    ? darkRule(serializeDeclarations({
        ...tokens(dark),
        ...ctaStyle(resolveCta(inputs.color, dark.background, dark.card, dark.primary)),
        ...errorStyle(dark),
      }))
    : null;

  return {
    style: {
      ...tokens(painted),
      ...ctaStyle(cta),
      ...errorStyle(painted),
      // Beside the tokens rather than inside themeStyle, which the dashboard
      // also calls and where globals.css and next-themes already own it.
      // Native inputs, scrollbars and autofill follow this, not the tokens.
      colorScheme: inputs.mode === "dark" ? "dark" : "light",
    } as CSSProperties,
    darkCss,
    formAccent: cta,
    themed: true,
  };
}
