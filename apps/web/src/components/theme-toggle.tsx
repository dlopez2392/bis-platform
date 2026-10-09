"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { THEME_COOKIE } from "@/lib/branding/theme-mode";

/**
 * The one toggle, shared: writes the `bis-theme` cookie, flips next-themes,
 * and asks the server to repaint. D-074: command-palette.tsx's "Toggle
 * theme" action used to call `setTheme` alone, a second, incomplete copy of
 * what this button does — it must call this function instead.
 *
 * Written here (not left to theme-cookie-sync.tsx's effect): that effect only
 * records an OS preference now, and the server has to see THIS choice on the
 * very next request even if the caller navigates immediately.
 *
 * `refresh()` is a themed-client requirement, found by an e2e test:
 * `setTheme` flips the `.dark` class instantly, which used to be enough
 * because globals.css defines a token block for each mode. A tenant's
 * derived tokens arrive as an inline style attribute on the shell, which
 * overrides BOTH blocks with one mode's values — so the class flipped while
 * `--background` stayed on the old mode, leaving dark surfaces under
 * light-mode styling until the next navigation. The cookie above is what the
 * server reads, so asking it to re-render is what actually repaints.
 * Harmless where no theme is emitted: the class flip already did the whole
 * job there.
 */
export function toggleTheme(
  resolvedTheme: string | undefined,
  setTheme: (theme: string) => void,
  refresh: () => void,
): void {
  const next = resolvedTheme === "dark" ? "light" : "dark";
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  setTheme(next);
  refresh();
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();

  // Both icons render; CSS picks one off the `.dark` class the provider sets
  // on <html>. That keeps this SSR-safe — the server can't know the resolved
  // theme, and guessing it would mean a hydration mismatch or a mount-state
  // effect. The label stays static for the same reason.
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid="theme-toggle"
      aria-label={m["theme.toggle"]}
      title={m["theme.toggle"]}
      onClick={() => toggleTheme(resolvedTheme, setTheme, () => router.refresh())}
    >
      <Moon className="size-4 dark:hidden" aria-hidden />
      <Sun className="hidden size-4 dark:block" aria-hidden />
    </Button>
  );
}
