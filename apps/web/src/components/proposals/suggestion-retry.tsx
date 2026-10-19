"use client";
// Retry for the Suggestions section's error state (item 8b-1, plan fix M6): re-runs the page's server
// reads and touches no other state. The record kit's RecordCardRetry shape.
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SuggestionRetry({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={() => router.refresh()}>
      {label}
    </Button>
  );
}
