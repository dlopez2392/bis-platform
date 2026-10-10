"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import type { PersonTheme } from "@bis/db";
import {
  followUpCookie,
  readCookieValue,
  THEME_COOKIE,
  nextThemeSync,
} from "@/lib/branding/theme-mode";

/**
 * Records the ONE thing about the theme that the server cannot work out for
 * itself: the operating system's preference, when a tenant has asked to follow
 * it. Also carries the one-time migration for a browser that already made an
 * explicit choice before this cookie existed. Renders nothing.
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
 * and it is the only case cookieModeToPersist writes for. A tenant default
 * the server already knows must never be echoed back as if the user had
 * chosen it.
 *
 * An effect is the only place a resolved system preference exists — with
 * enableSystem on, "system" is not known until the browser answers. This
 * effect sets no state, which keeps it clear of
 * react-hooks/set-state-in-effect, the rule that shaped the toggle's icon
 * handling in PR #2.
 *
 * Mis preferencias (F-096, D5): `userTheme`, the signed-in person's own
 * saved choice, is resolved first via `nextThemeSync` (userThemeSyncPlan, applied only when the stored value changes) and takes
 * priority over the brand_mode-driven logic below -- a person who has made
 * a deliberate choice is never subject to the tenant-follow migration, which
 * exists only to reconcile a tenant default with next-themes' own local
 * state. `plan.skipMigration` is true exactly when `userTheme` is non-null;
 * `plan.skipPersist` only for a stored light/dark, so "Follow my device"
 * keeps the OS snapshot in the cookie. With no stored choice the old branch
 * runs unchanged.
 */
export function ThemeCookieSync({ userTheme = null }: { userTheme?: PersonTheme | null }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  // The last stored value this effect applied (Task 6 fix round 1, I1): a
  // run caused only by a LOCAL theme change must not push the server's
  // stale prop back over it. See nextThemeSync.
  const lastApplied = useRef<PersonTheme | null | undefined>(undefined);

  useEffect(() => {
    const existing = readCookieValue(document.cookie, THEME_COOKIE);

    const sync = nextThemeSync(lastApplied.current, userTheme, theme, existing);
    lastApplied.current = sync.lastApplied;
    const plan = sync.plan;
    if (plan.setTheme) setTheme(plan.setTheme);
    if (plan.writeCookie) {
      document.cookie = `${THEME_COOKIE}=${plan.writeCookie}; path=/; max-age=31536000; samesite=lax`;
    }

    // The one-time migration (checked first) and the OS snapshot. Before this
    // component existed the toggle only ever called setTheme -- no cookie --
    // so every existing dark-mode user has `localStorage.theme = "dark"` and
    // no cookie; cookieModeToMigrate's own guard makes that a no-op once any
    // cookie exists. localStorage is read directly rather than useTheme()'s
    // `theme`, which has already been resolved through `defaultTheme` and
    // cannot tell a real stored choice from a default it was handed. The OS
    // snapshot is compared against the cookie already on the browser, which
    // is what keeps this from looping. A stored choice skips the migration; a
    // stored light/dark also skips the snapshot, but "Follow my device" keeps
    // it (final fix wave, I1). The decision is followUpCookie, pure and tested.
    const value = followUpCookie(plan, existing, window.localStorage.getItem("theme"), theme, resolvedTheme);
    if (!value) return;
    document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [theme, resolvedTheme, userTheme, router, setTheme]);

  return null;
}
