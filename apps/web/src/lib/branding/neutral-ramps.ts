/**
 * The three neutral ladders a tenant picks between. Chosen values, not
 * computed ones: a derived grey scale is one more thing to be subtly wrong,
 * and these are pinned by the contrast sweep in theme.test.ts.
 *
 * `sidebar` and `sidebarBorder` sit outside the light/dark split on purpose.
 * globals.css states the sidebar is dark in BOTH themes and does not invert,
 * and lightenForSidebar exists precisely because a dark brand scores 1.62:1
 * there. A light-mode tenant with a light sidebar would silently move the
 * background the 3:1 accent guarantee is measured against.
 */
/**
 * The array is the source and the type is derived from it, not the other way
 * round and not two hand-kept lists. The Settings action needs something it
 * can call `.includes()` on to validate a form field, so both forms have to
 * exist — and a duplicated literal list is a list that drifts. Adding a name
 * here without adding its ladder below fails typecheck, because NEUTRAL_RAMPS
 * is a Record over this type.
 */
export const NEUTRAL_NAMES = ["warm", "cool", "slate"] as const;
export type NeutralName = (typeof NEUTRAL_NAMES)[number];

export type RampSteps = {
  bg: string; card: string; subtle: string;
  border: string; mutedFg: string; fg: string;
};

export type Ramp = {
  light: RampSteps;
  dark: RampSteps;
  sidebar: string;
  sidebarBorder: string;
};

export const NEUTRAL_RAMPS: Record<NeutralName, Ramp> = {
  slate: {
    light: { bg: "#f8fafc", card: "#ffffff", subtle: "#eef2f7", border: "#dde3ea", mutedFg: "#5b6673", fg: "#0f172a" },
    dark:  { bg: "#0d1117", card: "#161b22", subtle: "#20262e", border: "#2c333c", mutedFg: "#9aa4b2", fg: "#e8edf3" },
    sidebar: "#111721", sidebarBorder: "#232b36",
  },
  warm: {
    light: { bg: "#faf9f7", card: "#ffffff", subtle: "#f2efea", border: "#e3ded6", mutedFg: "#6b6357", fg: "#1c1917" },
    dark:  { bg: "#12100e", card: "#1b1815", subtle: "#262220", border: "#332e2a", mutedFg: "#a8a09a", fg: "#f0ebe6" },
    sidebar: "#171310", sidebarBorder: "#2a2420",
  },
  cool: {
    light: { bg: "#f7f9fb", card: "#ffffff", subtle: "#eaf0f6", border: "#d8e1ea", mutedFg: "#556475", fg: "#101a24" },
    dark:  { bg: "#0b1016", card: "#141b23", subtle: "#1e262f", border: "#2a333e", mutedFg: "#93a2b3", fg: "#e6edf4" },
    sidebar: "#0e141c", sidebarBorder: "#202932",
  },
};

/** Unchanged from globals.css: the sidebar's text is the same in both themes. */
export const SIDEBAR_FOREGROUND = "#d4d4d8";
