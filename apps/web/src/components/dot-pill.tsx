import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Dot + word (DESIGN.md rule 3: status is never colour alone). The one pill
 * the automation history (`LogStatusPill`, a thin wrapper) and the calendar's
 * confirmation answer share, so they are one system rather than two copies
 * that happen to match today.
 *
 * It is the real `Badge variant="chip"`, so it keeps the badge's
 * `font-medium`, `w-fit`, `shrink-0` and `whitespace-nowrap`; the caller's
 * `chip` classes come after the variant's, and tailwind-merge lets the
 * treatment's ground, edge and ink win. The dot is the FIRST child.
 *
 * `dense` drops the roomier `py-1 pr-2.5 pl-2` so the badge's own
 * `px-2 py-0.5` stands: on a row that already carries a plain status badge
 * (the calendar's bookings list), the pill must match the badge beside it.
 * Any other span attribute (`data-status`, say) passes through to the pill.
 */
export function DotPill({
  label, chip, dot, dense = false, testId, ...props
}: {
  label: string;
  chip: string;
  dot: string;
  dense?: boolean;
  testId?: string;
} & Omit<React.ComponentProps<"span">, "children" | "className">) {
  return (
    <Badge
      variant="chip"
      className={cn("gap-1.5", !dense && "py-1 pr-2.5 pl-2", chip)}
      data-testid={testId}
      {...props}
    >
      <span className={cn("size-[7px] rounded-full", dot)} aria-hidden />
      {label}
    </Badge>
  );
}
