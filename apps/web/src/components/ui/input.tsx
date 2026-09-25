import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[var(--radius-ctl)] border border-[var(--input-line)] bg-[var(--input-bg)] px-3 py-1 text-[13px] transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
        "focus-visible:border-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring-glow)]",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

/**
 * A native form control painted exactly like `Input` above. Seven copies of a
 * hand-rolled `"… bg-transparent px-3 py-1.5 text-sm shadow-xs …
 * focus-visible:ring-ring/50"` shipped before this existed, and
 * `bg-transparent` on a translucent card is the actual visible bug — the
 * aurora reads straight through the control, so it stops looking like a field.
 *
 * NOT `nativeSelectClass`: all seven call sites (calendar-settings ×2,
 * voice-settings ×5) are `<textarea>`s, not `<select>`s — the audit that found
 * them named the wrong element. A string rather than a component because these
 * are controlled textareas with `value`/`onChange`, `placeholder` and
 * server-action `name` wiring, and a wrapper would only get in the way.
 */
export const nativeFieldClass =
  "w-full rounded-[var(--radius-ctl)] border border-[var(--input-line)] bg-[var(--input-bg)] px-3 py-2 text-[13px] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring-glow)]"

export { Input }
