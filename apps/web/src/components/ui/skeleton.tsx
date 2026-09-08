import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-[var(--surface-2)] shadow-[var(--glass-highlight)]", className)}
      {...props}
    />
  )
}

export { Skeleton }
