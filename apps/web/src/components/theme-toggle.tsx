"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { THEME_COOKIE } from "@/lib/branding/theme-mode";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

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
      onClick={() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
        // The sync effect would also catch this, but writing it here means the
        // very next request is correct even if the user navigates immediately.
        document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        setTheme(next);
      }}
    >
      <Moon className="size-4 dark:hidden" aria-hidden />
      <Sun className="hidden size-4 dark:block" aria-hidden />
    </Button>
  );
}
