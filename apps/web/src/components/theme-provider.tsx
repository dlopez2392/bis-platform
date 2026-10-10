"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { PersonTheme } from "@bis/db";
import { ThemeCookieSync } from "@/components/theme-cookie-sync";

export function ThemeProvider({
  children,
  defaultTheme = "light",
  userTheme = null,
}: {
  children: React.ReactNode;
  /** Resolved server-side from the cookie, so the first paint matches the
   *  token set the dashboard shell emitted. */
  defaultTheme?: "light" | "dark" | "system";
  /** Mis preferencias (F-096, D5): the signed-in person's own saved theme,
   *  resolved server-side the same request. Forwarded to ThemeCookieSync,
   *  which is where it actually does something -- this component only
   *  passes it through. */
  userTheme?: PersonTheme | null;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      // On, so a tenant's brand_mode = 'follow' means something. It was off
      // when the toggle shipped in PR #2 and there was nothing to follow.
      enableSystem
      disableTransitionOnChange
    >
      <ThemeCookieSync userTheme={userTheme} />
      {children}
    </NextThemesProvider>
  );
}
