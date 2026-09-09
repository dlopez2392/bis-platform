import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one status banner in the app (Northern Lights §status). Ten call sites
 * hand-rolled `rounded-md border border-{warning|destructive}/40 bg-{…}/10`
 * before this existed; the mockup's own status treatment (`.chip.good/.warn/
 * .crit`, northern-lights.html:149-150) is a TINTED GROUND with a
 * TRANSPARENT border, never an alpha of the hue used as an outline.
 *
 * Ink defaults to the tone token. Several call sites deliberately keep
 * `text-foreground` instead — a full sentence in `--warn` sits close to the
 * AA floor, and the repo's standing rule (setup-shell.tsx's own comment) is
 * that a SENTENCE keeps the foreground and lets the ground and the icon carry
 * the hue. Those sites pass `className="text-foreground"`; `cn()`'s
 * tailwind-merge lets the later colour win.
 *
 * Never `glass`: every one of these sits inside a card, a dialog or a sheet,
 * and a second `--shadow-card` inside the first doubles the ambient.
 */
export function Notice({
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { tone: "good" | "warn" | "crit" }) {
  return (
    <div
      role="alert"
      data-slot="notice"
      className={cn(
        "rounded-[8px] border border-transparent px-3 py-2 text-sm",
        tone === "good" && "bg-[var(--good-bg)] text-[var(--good)]",
        tone === "warn" && "bg-[var(--warn-bg)] text-[var(--warn)]",
        tone === "crit" && "bg-[var(--crit-bg)] text-[var(--crit)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
