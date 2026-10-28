"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Toasts (components/ui/sonner.tsx): the app's one Toaster draws them from
 * tokens with Sonner's own styling off (sonner-style.test.ts). One button per
 * kind the app raises — an Undo toast (rule 6), a failure and a warning — so
 * both themes can be checked by eye and by computed value. Each kind differs
 * by its icon's shape and by its words, never by colour alone (rule 3).
 * Nothing here writes anything.
 */
export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2" data-slot="toast-demo">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          toast.success("Marked done.", {
            action: { label: "Undo", onClick: () => toast("Back on your list.") },
          })
        }
      >
        Undo toast
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => toast.error("Could not update this booking.", { description: "Nothing was changed. Try again in a moment." })}
      >
        Failure toast
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => toast.warning("This number could not be checked.")}
      >
        Warning toast
      </Button>
    </div>
  );
}
