// apps/web/src/lib/branding/oklch.ts
//
// Pure hex ↔ OKLCH (Björn Ottosson's matrices) and the second-accent rule
// from the Northern Lights spec §3.3. No I/O, no DOM.
export type Oklch = { l: number; c: number; h: number };

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function hexToOklch(hex: string): Oklch {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(a, bb);
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** Linear-light sRGB, unclamped — negative or >1 channels mean out of gamut. */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const bb = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

export function oklchToHex(o: Oklch): string {
  const to255 = (v: number) => Math.round(clamp01(linearToSrgb(clamp01(v))) * 255).toString(16).padStart(2, "0");
  const [r, g, b] = oklchToLinearRgb(o);
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/**
 * The largest chroma <= `c` that sRGB can actually show at this lightness and
 * hue, found by bisection on the in-gamut predicate.
 *
 * Needed because the §3.3 rule asks for colours sRGB does not have: a brand
 * violet lifted to L .85 wants C .159 at H 256°, and blue runs out of gamut
 * near C .08 up there. `oklchToHex`'s per-channel clamp is the wrong repair
 * for that — clamping red to 1 while green and blue stay put moves the HUE,
 * by 16.5° for BIS's own #8b7cf7, which breaks the one thing §3.3 actually
 * guarantees ("analogous, never complementary", pinned at -30° +/- 6°).
 * Giving up chroma instead keeps L and H exactly and costs only saturation,
 * which is the axis the rule was already shrinking. This is CSS Color 4's
 * gamut-mapping shape (chroma reduction at constant L/H), minus its deltaE
 * refinement step, which is finer than an 8-bit channel can render anyway.
 *
 * 24 halvings resolve chroma to ~1e-8, far below a hex step; the loop is a
 * fixed count so no float edge can spin it.
 */
function fitChroma(l: number, c: number, h: number): number {
  if (oklchToLinearRgb({ l, c, h }).every((v) => v >= 0 && v <= 1)) return c;
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (oklchToLinearRgb({ l, c: mid, h }).every((v) => v >= 0 && v <= 1)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Spec §3.3: lightness +0.18 (clamped to 0.85), chroma ×0.9, hue −30°. */
export function deriveAccent2(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  const l2 = Math.min(0.85, l + 0.18);
  const h2 = (h - 30 + 360) % 360;
  return oklchToHex({ l: l2, c: fitChroma(l2, c * 0.9, h2), h: h2 });
}
