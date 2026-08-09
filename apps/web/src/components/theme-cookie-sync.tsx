"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { THEME_COOKIE } from "@/lib/branding/theme-mode";

/**
 * Keeps the cookie equal to whatever next-themes actually resolved, so the
 * next request paints the right token set on the server.
 *
 * An effect is the only place the resolved value exists — with
 * enableSystem on, "system" is not known until the browser answers. This
 * effect sets no state, which is what keeps it clear of
 * react-hooks/set-state-in-effect, the rule that shaped the toggle's icon
 * handling in PR #2. Renders nothing.
 */
export function ThemeCookieSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    document.cookie = `${THEME_COOKIE}=${resolvedTheme}; path=/; max-age=31536000; samesite=lax`;
  }, [resolvedTheme]);

  return null;
}
