"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import type { PersonTheme } from "@bis/db";
import {
  cookieModeToMigrate,
  cookieModeToPersist,
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
 * state. `plan.skipMigration` is true exactly when `userTheme` is non-null,
 * so the old branch runs unchanged for everyone else.
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
    if (plan.skipMigration) return;

    // One-time migration, checked first. Before this component existed the
    // toggle only ever called setTheme -- no cookie -- so every existing
    // dark-mode user has `localStorage.theme = "dark"` and no cookie today.
    // cookieModeToMigrate's own guard means this is a no-op on every run
    // after the first: once it writes a cookie, `existing` stops being
    // undefined and it returns null forever after. Read directly from
    // localStorage rather than useTheme()'s `theme`, which by the time this
    // runs has already been resolved through `defaultTheme` and cannot tell
    // a real stored choice apart from a default it was merely handed.
    const migrated = cookieModeToMigrate(existing, window.localStorage.getItem("theme"));
    if (migrated) {
      document.cookie = `${THEME_COOKIE}=${migrated}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
      return;
    }

    // The decision itself lives in cookieModeToPersist, which is pure and
    // unit-tested; this effect only carries out whatever it says. Compared
    // against the cookie already on the browser (not just "did we compute a
    // value") so that a `follow` tenant's server-painted tokens catch up
    // when the OS preference actually changes, without refreshing on every
    // render that resolves to the same answer already sitting in the cookie
    // -- that comparison is what keeps this from looping.
    const value = cookieModeToPersist(theme, resolvedTheme);
    if (!value || value === existing) return;
    document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [theme, resolvedTheme, userTheme, router, setTheme]);

  return null;
}
