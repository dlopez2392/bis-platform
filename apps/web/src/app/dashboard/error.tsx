"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged for developer diagnosis only — the UI never surfaces the raw
    // message or stack trace to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState
        icon={AlertTriangle}
        title={m["error.title"]}
        body={m["error.body"]}
        action={
          <Button variant="outline" onClick={() => reset()}>
            {m["error.retry"]}
          </Button>
        }
      />
    </div>
  );
}
