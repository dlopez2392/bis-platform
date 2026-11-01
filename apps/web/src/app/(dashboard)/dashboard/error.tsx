"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useLocale();
  useEffect(() => {
    // Logged for developer diagnosis only — the UI never surfaces the raw
    // message or stack trace to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        icon={AlertTriangle}
        title={t(m, "error.title", locale)}
        body={t(m, "error.body", locale)}
        action={
          <Button variant="outline" onClick={() => reset()}>
            {t(m, "error.retry", locale)}
          </Button>
        }
      />
    </div>
  );
}
