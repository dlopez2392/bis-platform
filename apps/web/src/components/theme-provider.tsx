"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ThemeCookieSync } from "@/components/theme-cookie-sync";

export function ThemeProvider({
  children,
  defaultTheme = "light",
}: {
  children: React.ReactNode;
  /** Resolved server-side from the cookie, so the first paint matches the
   *  token set the dashboard shell emitted. */
  defaultTheme?: "light" | "dark" | "system";
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
      <ThemeCookieSync />
      {children}
    </NextThemesProvider>
  );
}
