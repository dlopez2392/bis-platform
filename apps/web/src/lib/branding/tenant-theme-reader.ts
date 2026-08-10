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
import { cookies } from "next/headers";
import { serviceDb, getBranding } from "@bis/db";
import type { Branding } from "@bis/db";
import { resolveClientAccessState } from "@/lib/auth";
import { themeInputsFrom } from "./tenant-theme";
import { resolveThemeMode, THEME_COOKIE } from "./theme-mode";
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

/**
 * The decision resolveThemeMode makes, pulled out of getRequestTheme below so
 * it can be unit-tested directly: given the raw cookie value and this
 * tenant's already-resolved inputs, which mode the server paints
 * (`serverMode`) and which default next-themes gets (`providerDefault`). A
 * hook or request-bound body cannot be honestly tested in this repo -- that
 * is exactly why the previous attempt at covering this duplication resorted
 * to hand-written stand-ins in theme-mode.test.ts (1:1 copies of two call
 * sites) instead of testing a real one. This IS the real call site now, and
 * it is small enough to test without cookies() or the database.
 */
export function pickRequestThemeMode(
  cookie: string | undefined,
  inputs: ThemeInputs,
): { serverMode: "light" | "dark"; providerDefault: "light" | "dark" | "system" } {
  return resolveThemeMode(cookie, inputs.mode);
}

export type RequestTheme = {
  inputs: ThemeInputs;
  serverMode: "light" | "dark";
  providerDefault: "light" | "dark" | "system";
};

/**
 * The one place resolveThemeMode is invoked for a request. The root layout
 * and the dashboard shell used to each write their own
 * `resolveThemeMode(cookie, inputs.mode)` line -- one call per file, free to
 * drift the moment either one changed without the other, which is exactly
 * what happened: the root layout shipped with a hardcoded `null` where its
 * tenant's mode belonged. Both now call this instead and take whichever half
 * they need: the root layout takes `providerDefault` (the class next-themes
 * puts on `<html>`); the dashboard shell takes `serverMode` and `inputs` (to
 * derive the token set it paints). There is no longer a second place either
 * fact could disagree with the other.
 *
 * cache()'d for the same reason as `getTenantAccessState`/`getTenantBranding`
 * above, and importing THIS exact binding is what makes that dedupe real --
 * see the doc comment on `getTenantAccessState`. React keys the memo on the
 * wrapped function's identity, not its source, so a second `cache(...)`
 * wrapped around the same logic in a different file would not share this
 * one's memo. Both layouts must import `getRequestTheme` itself, not
 * reimplement it.
 *
 * Never throws. Same posture as `getTenantThemeInputs`, which this calls and
 * which already degrades to "no tenant" on any fault of its own -- this
 * function's own try/catch exists for the one thing that reader doesn't
 * cover, reading the cookie store. Either way, the root layout renders
 * `/sign-in` and `/no-access` too, so a fault here must degrade to "no
 * tenant, light mode" rather than take either page down.
 */
export const getRequestTheme = cache(async (): Promise<RequestTheme> => {
  try {
    const [cookieStore, inputs] = await Promise.all([cookies(), getTenantThemeInputs()]);
    return { inputs, ...pickRequestThemeMode(cookieStore.get(THEME_COOKIE)?.value, inputs) };
  } catch (e) {
    console.error(`tenant-theme: request theme read failed: ${String(e)}`);
    const inputs = themeInputsFrom(null);
    return { inputs, ...pickRequestThemeMode(undefined, inputs) };
  }
});
