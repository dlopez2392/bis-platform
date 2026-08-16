import { describe, it, expect } from "vitest";
import { themeInputsFrom } from "./tenant-theme";
import type { Branding } from "@bis/db";

const FULL: Branding = {
  brandName: "Acme Corp",
  brandLogoPath: "acme/logo.png",
  brandColor: "#112233",
  brandNeutral: "warm",
  brandCorners: "round",
  brandType: "serif",
  brandMode: "dark",
  replyToEmail: null,
};

const COLOR_ONLY: Branding = {
  brandName: null,
  brandLogoPath: null,
  brandColor: "#abcdef",
  brandNeutral: null,
  brandCorners: null,
  brandType: null,
  brandMode: null,
  replyToEmail: null,
};

describe("themeInputsFrom", () => {
  // The agency's chrome, and any account nobody has branded yet, both take
  // this path. There is no theme to derive -- deriveTheme's own null-branch
  // depends on every field here reading back null, not just `mode`.
  it("maps a null branding to an all-null ThemeInputs", () => {
    expect(themeInputsFrom(null)).toEqual({
      color: null, neutral: null, corners: null, type: null, mode: null,
    });
  });

  // Every one of the five stored inputs makes it through, under its
  // derivation name -- this is the mapping both the shell and the Settings
  // preview trust to be complete.
  it("maps every field through when branding is fully set", () => {
    expect(themeInputsFrom(FULL)).toEqual({
      color: "#112233", neutral: "warm", corners: "round", type: "serif", mode: "dark",
    });
  });

  // PR #10's shape: brand_color alone, shipped as sidebar-accent-only. `mode`
  // reads back null here same as the other three -- a colour-only account
  // must not accidentally pick up a mode it never set.
  it("maps a colour-only branding to color set and everything else null", () => {
    expect(themeInputsFrom(COLOR_ONLY)).toEqual({
      color: "#abcdef", neutral: null, corners: null, type: null, mode: null,
    });
  });
});
