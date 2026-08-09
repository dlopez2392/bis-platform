import { describe, it, expect } from "vitest";
import { deriveTheme } from "./theme";
import { themeStyle } from "./theme-style";

const theme = deriveTheme(
  { color: "#1e3a8a", neutral: "slate", corners: "round", type: "serif", mode: null },
  "light",
)!;

describe("themeStyle", () => {
  it("emits every token as a CSS custom property", () => {
    const style = themeStyle(theme) as Record<string, string>;
    expect(style["--background"]).toBe("#f8fafc");
    expect(style["--radius"]).toBe("1rem");
    expect(style["--font-sans"]).toBe("var(--font-source-serif)");
    expect(style["--sidebar-accent"]).toBe(theme.sidebarAccent);
  });

  // --radius-sm/md/lg are defined in globals.css as calc() over var(--radius).
  // Custom properties are substituted per element, so overriding --radius is
  // enough and re-emitting the derived ones would be a second source of truth.
  it("does not re-emit the radii globals.css derives", () => {
    const style = themeStyle(theme) as Record<string, string>;
    expect(style["--radius-sm"]).toBeUndefined();
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

  // Defence in depth. Nothing should be able to reach this function with a
  // hostile value -- four inputs are DB-constrained and the colour is
  // hex-validated -- but this is the last gate before a style attribute, and
  // the whole finding was that a value here can append CSS declarations.
  it("drops a value that is not a plain colour or length", () => {
    const hostile = { ...theme, background: "#fff;position:fixed;inset:0", radius: "9px;color:red" };
    const style = themeStyle(hostile) as Record<string, string>;
    expect(style["--background"]).toBe("#f8f8fb"); // BIS light default
    expect(style["--radius"]).toBe("0.625rem");
  });

  it("rejects even valid CSS it cannot prove is declaration-free", () => {
    const hostile = { ...theme, background: "var(--x)", radius: "calc(1rem + 2px)" };
    const style = themeStyle(hostile) as Record<string, string>;
    expect(style["--background"]).toBe("#f8f8fb");
    expect(style["--radius"]).toBe("0.625rem");
  });
});
