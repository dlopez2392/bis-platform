"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * The Preferences page's own boundary (rule 5): `loadMyPreferences` threw.
 * One sentence in the person's locale and a ghost Reload; the page has no
 * primary action to compete with. `router.refresh()` re-runs the server
 * read and `reset()` re-renders this segment against it.
 */
export default function PreferencesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    // For a developer only; the raw message never reaches the screen.
    console.error(error);
  }, [error]);

  return (
    <div data-prefs-error className="flex min-h-[60vh] items-center justify-center p-6" lang={locale}>
      <EmptyState
        icon={AlertTriangle}
        title={t(m, "prefs.title", locale)}
        body={t(m, "prefs.error.load", locale)}
        action={
          <Button
            variant="ghost"
            onClick={() =>
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            {t(m, "prefs.reload", locale)}
          </Button>
        }
      />
    </div>
  );
}
