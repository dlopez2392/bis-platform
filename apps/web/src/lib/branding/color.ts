/**
 * Color math for brand accents. Pure and I/O-free on purpose, so it can be
 * unit-tested and mutation-tested — the same reason validate-logo.ts is
 * separate from the action that uses it.
 */

const HEX = /^#[0-9a-f]{6}$/i;

/** BIS violet. What an unbranded form has always used. */
export const FORM_ACCENT_FALLBACK = "#6d28d9";
/** --sidebar in globals.css. The sidebar is dark in BOTH themes by design. */
export const SIDEBAR_BG = "#1e1b2e";
/** WCAG 1.4.11 for non-text UI components, which is what these accents are. */
const SIDEBAR_MIN_RATIO = 3;
const LIGHTEN_STEP = 0.02;
const LIGHTEN_CEILING = 0.95;

/**
 * The only way a color enters this module.
 *
 * Deliberately strict: this value ends up in a CSS custom property on a page
 * served to the client's customers, so "looks like a color" is not good
 * enough. A named color or a url() would both be accepted by CSS.
 */
export function parseHexColor(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  return HEX.test(v) ? v : null;
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const lums = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  const hi = lums[0]!;
  const lo = lums[1]!;
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of white or near-black is legible on this color. */
export function readableTextOn(hex: string): "#ffffff" | "#111111" {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#111111")
    ? "#ffffff"
    : "#111111";
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l]; // achromatic; hue is undefined, not zero-ish
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    : max === gn ? ((bn - rn) / d + 2) / 6
    : ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number): string {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Raises lightness until the color is visible on the dark sidebar.
 *
 * Hue and saturation are preserved exactly (spec section 5): a very dark navy
 * becomes a lighter navy rather than shifting toward a more legible hue.
 * Silently changing a company's hue is the worse failure, and the Settings
 * preview shows the operator the result before they save.
 *
 * Returns the input unchanged when it already clears the threshold, and the
 * best it managed if it runs out of headroom.
 */
export function lightenForSidebar(hex: string): string {
  const [h, s, startL] = rgbToHsl(...channels(hex));
  let l = startL;
  let out = hex;
  while (contrastRatio(out, SIDEBAR_BG) < SIDEBAR_MIN_RATIO && l < LIGHTEN_CEILING) {
    l = Math.min(LIGHTEN_CEILING, l + LIGHTEN_STEP);
    out = hslToHex(h, s, l);
  }
  return out;
}

/**
 * The public form's accent and the text color that stays legible on it.
 *
 * Re-validates rather than trusting the stored value — the second half of the
 * validate-on-write-and-on-read rule. Surfaces call this instead of deriving
 * their own, so none of them can forget.
 */
export function resolveFormAccent(
  brandColor: string | null,
): { accent: string; accentForeground: string } {
  const accent = parseHexColor(brandColor) ?? FORM_ACCENT_FALLBACK;
  return { accent, accentForeground: readableTextOn(accent) };
}

/** The sidebar's accent, or null to leave today's light/dark-tuned tokens alone. */
export function resolveSidebarAccent(brandColor: string | null): string | null {
  const c = parseHexColor(brandColor);
  return c ? lightenForSidebar(c) : null;
}
