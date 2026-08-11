/**
 * The DB row shape to the derivation shape, in one place. Both the shell and
 * the Settings preview go through this, so neither can invent its own mapping.
 *
 * Deliberately free of any runtime `@bis/db` import: `Branding` crosses in as
 * a type only, so a future client-side Settings preview can import
 * `themeInputsFrom` (the same way branding-panel.tsx already avoids
 * `brandLogoUrl` for the identical reason) without pulling the service-role
 * client into the browser bundle. The request-cached DB reads that produce a
 * `Branding` to feed this live in `./tenant-theme-reader`, a separate module
 * for exactly that reason.
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
