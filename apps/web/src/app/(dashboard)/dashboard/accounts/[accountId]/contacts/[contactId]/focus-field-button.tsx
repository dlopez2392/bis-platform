"use client";

import { Button } from "@/components/ui/button";

/** Next up's empty-state action (spec §9.3): moves focus to the timeline's To-do field. */
export function FocusFieldButton({ targetId, label }: { targetId: string; label: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-8"
      onClick={() => {
        const el = document.getElementById(targetId);
        el?.scrollIntoView({ block: "center" });
        el?.focus();
      }}>
      {label}
    </Button>
  );
}
