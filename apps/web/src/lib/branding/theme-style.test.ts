import { describe, it, expect } from "vitest";
import { deriveTheme, type ThemeInputs } from "./theme";
import { themeStyle } from "./theme-style";

const INPUTS: ThemeInputs = {
  color: "#1e3a8a", neutral: "slate", corners: "round", type: "serif", mode: null,
};

const theme = deriveTheme(INPUTS, "light")!;

/** The percentage themeStyle mixes a tint at, from the theme's own table. */
const pct = (a: number) => Math.round(a * 100);

describe("themeStyle", () => {
  it("emits every token as a CSS custom property", () => {
    const style = themeStyle(theme) as Record<string, string>;
    expect(style["--background"]).toBe("#f8fafc");
    expect(style["--radius"]).toBe("1rem");
    expect(style["--font-sans"]).toBe("var(--font-source-serif)");
    expect(style["--sidebar-accent"]).toBe(theme.sidebarAccent);
    const a = theme.accentAlphas;
    expect(style["--accent"]).toBe(theme.primary);
    expect(style["--accent-strong"]).toBe(theme.accentStrong);
    expect(style["--accent-dim"]).toBe(`color-mix(in srgb, ${theme.primary} ${pct(a.accentDim)}%, transparent)`);
    expect(style["--ring-glow"]).toBe(`color-mix(in srgb, ${theme.ring} ${pct(a.ringGlow)}%, transparent)`);
    expect(style["--accent-2"]).toBe(theme.accent2);
    expect(style["--accent-2-dim"]).toBe(`color-mix(in srgb, ${theme.accent2} ${pct(a.accent2Dim)}%, transparent)`);
    expect(style["--ring-glow-2"]).toBe(`color-mix(in srgb, ${theme.accent2} ${pct(a.ringGlow2)}%, transparent)`);
    expect(style["--sidebar-tint-2"]).toBe(theme.accent2);
    expect(style["--glow-1-alpha"]).toBe(String(theme.glowAlphas.glow1));
    expect(style["--glow-2-alpha"]).toBe(String(theme.glowAlphas.glow2));
    expect(style["--glow-3-alpha"]).toBe(String(theme.glowAlphas.glow3));
  });

  // The tenant seam, written down in DESIGN.md → Foundations → "Tenant seam":
  // this list mirrors that paragraph and is exactly what a tenant's theme
  // overrides. Everything NOT here is mode-keyed chrome (--surface-0..3,
  // --surface-overlay, --line, --line-strong, --text-1..3), so adding or
  // dropping a key is a deliberate change to the seam — and to that paragraph
  // — rather than an implementation detail nobody notices.
  const SEAM_KEYS = [
    "--background", "--foreground",
    "--card", "--card-foreground",
    "--popover", "--popover-foreground",
    "--primary", "--primary-foreground",
    "--secondary", "--secondary-foreground",
    "--muted", "--muted-foreground",
    "--border", "--input", "--ring",
    "--accent", "--accent-strong", "--accent-dim", "--ring-glow",
    "--accent-2", "--accent-2-dim", "--ring-glow-2",
    "--sidebar-tint-2",
    "--glow-1-alpha", "--glow-2-alpha", "--glow-3-alpha",
    "--sidebar", "--sidebar-foreground", "--sidebar-accent", "--sidebar-border",
    "--radius", "--font-sans",
  ];

  it("emits exactly the seam's key set — adding or dropping a tenant-driven property is a deliberate DESIGN.md change", () => {
    expect(Object.keys(themeStyle(theme)).sort()).toEqual([...SEAM_KEYS].sort());
  });

  // --gradient-primary is linear-gradient(180deg, var(--accent),
  // var(--accent-strong)): the two stops must be two colours, or a themed
  // tenant's primary button renders as a flat fill.
  it("gives --accent-strong its own value rather than aliasing --accent", () => {
    const style = themeStyle(theme) as Record<string, string>;
    expect(style["--accent-strong"]).not.toBe(theme.primary);
    expect(style["--accent-strong"]).not.toBe(style["--accent"]);
  });

  // tokens.css pins the tint alphas PER MODE — light .09/.28, dark .14/.35 —
  // and themeStyle hard-coded the dark pair for one commit, so a themed light
  // tenant (the client default) got the stronger dark tints. Both modes are
  // built from the same inputs here, so only the alphas can separate them.
  it("mixes the tints at the light alphas in light mode and the dark alphas in dark mode", () => {
    const light = themeStyle(deriveTheme(INPUTS, "light")!) as Record<string, string>;
    const dark = themeStyle(deriveTheme(INPUTS, "dark")!) as Record<string, string>;
    expect(light["--accent-dim"]).toContain(" 9%,");
    expect(dark["--accent-dim"]).toContain(" 14%,");
    expect(light["--accent-dim"]).not.toBe(dark["--accent-dim"]);
    expect(light["--ring-glow"]).toContain(" 28%,");
    expect(dark["--ring-glow"]).toContain(" 35%,");
  });

  // --radius-sm/md/lg are defined in globals.css as calc() over var(--radius).
  // Custom properties are substituted per element, so overriding --radius is
  // enough and re-emitting the derived ones would be a second source of truth.
  it("does not re-emit the radii globals.css derives", () => {
    const style = themeStyle(theme) as Record<string, string>;
    expect(style["--radius-sm"]).toBeUndefined();
    expect(style["--radius-md"]).toBeUndefined();
    expect(style["--radius-lg"]).toBeUndefined();
  });

  // Spec §4.2: status colours carry meaning and pipeline stages are semantic
  // identity, so neither is a tenant's to set. Emitting them at all would let
  // a future edit make a red stop reading as red.
  it("never emits the tokens that are not a tenant's to set", () => {
    const style = themeStyle(theme) as Record<string, string>;
    for (const token of ["--destructive", "--success", "--warning",
                         "--stage-1", "--stage-2", "--stage-3",
                         "--stage-4", "--stage-5", "--stage-6"]) {
      expect(style[token], token).toBeUndefined();
    }
  });

  // The brand `--accent` custom property (tokens.css) must never be shadowed
  // on <body> by the OLD shadcn hover-surface pair. themeStyle used to
  // re-emit `--accent`/`--accent-foreground` as that pair (dead for rendering
  // since globals.css's @theme inline now reads --surface-3/--text-1
  // directly) — but the NAME collided with the brand token, so a themed
  // account's body subtree had the brand accent overridden by whatever the
  // ramp's subtle/fg pair happened to be.
  //
  // Since the Northern Lights refresh, `--accent` IS emitted here — carrying
  // the tenant's own lifted primary, which is the value the collision was
  // stealing the name from. So the invariant is no longer "never emitted",
  // it is "never the ramp's hover surface": the guard is retargeted at the
  // actual defect rather than dropped. `--accent-foreground` has no brand
  // meaning at all and is still never emitted. Checked against the
  // serialized string, not just the keys, so an emission under a different
  // code path still trips this.
  it("never shadows the brand --accent token: --accent is the brand primary, never the ramp's hover surface", () => {
    const style = themeStyle(theme) as Record<string, string>;
    const serialized = Object.entries(style).map(([k, v]) => `${k}:${v};`).join("");
    expect(serialized).toMatch(`--accent:${theme.primary};`);
    expect(style["--accent"]).not.toBe(theme.secondary);
    expect(style["--accent"]).not.toBe(theme.muted);
    expect(serialized).not.toMatch(/--accent-foreground:/);
  });

  // Defence in depth. Nothing should be able to reach this function with a
  // hostile value -- four inputs are DB-constrained and the colour is
  // hex-validated -- but this is the last gate before a style attribute, and
  // the whole finding was that a value here can append CSS declarations.
  it("drops a value that is not a plain colour or length", () => {
    const hostile = { ...theme, background: "#fff;position:fixed;inset:0", radius: "9px;color:red" };
    const style = themeStyle(hostile) as Record<string, string>;
    expect(style["--background"]).toBe("#efebf9"); // BIS light default
    expect(style["--radius"]).toBe("0.75rem");
  });

  it("rejects even valid CSS it cannot prove is declaration-free", () => {
    const hostile = { ...theme, background: "var(--x)", radius: "calc(1rem + 2px)" };
    const style = themeStyle(hostile) as Record<string, string>;
    expect(style["--background"]).toBe("#efebf9");
    expect(style["--radius"]).toBe("0.75rem");
  });
});
