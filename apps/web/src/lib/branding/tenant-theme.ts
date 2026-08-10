/**
 * The DB row shape to the derivation shape, in one place. Both the shell and
 * the Settings preview go through this, so neither can invent its own mapping.
 */
import type { Branding } from "@bis/db";
import type { ThemeInputs } from "./theme";

export function themeInputsFrom(branding: Branding | null): ThemeInputs {
  return {
    color: branding?.brandColor ?? null,
    neutral: branding?.brandNeutral ?? null,
    corners: branding?.brandCorners ?? null,
    type: branding?.brandType ?? null,
    mode: branding?.brandMode ?? null,
  };
}
