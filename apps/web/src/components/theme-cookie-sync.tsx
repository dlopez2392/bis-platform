"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { cookieModeToPersist, THEME_COOKIE } from "@/lib/branding/theme-mode";

/**
 * Records the ONE thing about the theme that the server cannot work out for
 * itself: the operating system's preference, when a tenant has asked to follow
 * it. Renders nothing.
 *
 * Deliberately narrow. This used to write the cookie for whatever next-themes
 * resolved, on every route, and that quietly destroyed the feature it was
 * meant to support: `/sign-in` is wrapped by the same root layout, has no
 * tenant to ask, and therefore resolves `light` — so a user's very first page
 * view baked `bis-theme=light` before they were even signed in, and the cookie
 * outranks a tenant's `brand_mode` in every later request. A company that
 * chose a dark default would never have seen one. Caught by an e2e test whose
 * fixture had exactly that cookie in its saved storage state.
 *
 * The cookie means "the user's own answer", and there are only two ways to
 * have one: they clicked the toggle (which writes it there, in the same
 * gesture), or their tenant said "follow the device" and the browser told us
 * what the device prefers. `theme === "system"` is precisely that second case,
 * and it is the only case this effect writes for. A tenant default the server
 * already knows must never be echoed back as if the user had chosen it.
 *
 * An effect is the only place a resolved system preference exists — with
 * enableSystem on, "system" is not known until the browser answers. This
 * effect sets no state, which keeps it clear of
 * react-hooks/set-state-in-effect, the rule that shaped the toggle's icon
 * handling in PR #2.
 */
export function ThemeCookieSync() {
  const { theme, resolvedTheme } = useTheme();

  useEffect(() => {
    // The decision itself lives in cookieModeToPersist, which is pure and
    // unit-tested; this effect only carries out whatever it says.
    const value = cookieModeToPersist(theme, resolvedTheme);
    if (!value) return;
    document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
  }, [theme, resolvedTheme]);

  return null;
}
