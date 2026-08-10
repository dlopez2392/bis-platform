/**
 * The server-only half of tenant-theme.ts: who is asking, and what they're
 * branded, resolved once per request and shared by both layouts that need
 * it. Split from tenant-theme.ts on purpose -- that module's `themeInputsFrom`
 * is meant to stay safe for a future client-side Settings preview to import
 * (see its own doc comment), and `serviceDb`/`getBranding` below are exactly
 * the service-role, Node-only code branding-panel.tsx already avoids pulling
 * into a browser bundle for the same reason.
 */
import { cache } from "react";
import { serviceDb, getBranding } from "@bis/db";
import type { Branding } from "@bis/db";
import { resolveClientAccessState } from "@/lib/auth";
import { themeInputsFrom } from "./tenant-theme";
import type { ThemeInputs } from "./theme";

/**
 * Who is asking, resolved once and shared. dashboard/layout.tsx used to hold
 * its own `cache(resolveClientAccessState)` for generateMetadata and its own
 * body; the root layout needs the identical answer to know this tenant's
 * brand_mode, and a second `cache()` wrapper around the same function would
 * NOT dedupe with this one -- React keys the memo on the wrapped function's
 * identity, not its source. Both layouts import this exact binding so a
 * request that renders both (every /dashboard/* route) still resolves the
 * caller only once.
 */
export const getTenantAccessState = cache(resolveClientAccessState);

/**
 * Branding is decoration, so a fault reading it must not cost the client
 * their whole dashboard. Moved here unchanged from dashboard/layout.tsx --
 * same reasoning, same degrade-to-unbranded fallback -- so both layouts share
 * one cached read per account instead of each holding a private copy that
 * would issue its own query.
 */
export const getTenantBranding = cache(async (accountId: string): Promise<Branding> => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`tenant-theme: branding read failed for account ${accountId}: ${String(e)}`);
    return {
      brandName: null, brandLogoPath: null, brandColor: null,
      brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
    };
  }
});

/**
 * The one fact the root layout and the dashboard shell must agree on: this
 * tenant's theme inputs. Built from the same two cached calls the shell
 * already makes for the sidebar's name/logo/accent, so a /dashboard/*
 * request never pays for this twice -- and a route the root layout wraps
 * alone (/sign-in, /no-access) still gets a real answer without
 * dashboard/layout.tsx's redirects ever running, because this function
 * never redirects.
 *
 * Never throws. The root layout mounts on every route that exists, including
 * the two above, which previously depended on nothing but a cookie. Before
 * this, a database fault reading WHO the caller is (not just reading their
 * branding) had nowhere to reach the root layout from; now that it can, the
 * same fault must still degrade to "no tenant" here rather than take down
 * /sign-in.
 */
export const getTenantThemeInputs = cache(async (): Promise<ThemeInputs> => {
  try {
    const state = await getTenantAccessState();
    if (state.status !== "ok") return themeInputsFrom(null);
    const branding = await getTenantBranding(state.id);
    return themeInputsFrom(branding);
  } catch (e) {
    console.error(`tenant-theme: theme inputs read failed: ${String(e)}`);
    return themeInputsFrom(null);
  }
});
