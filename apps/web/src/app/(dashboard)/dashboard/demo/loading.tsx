import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the real page (DESIGN.md rule 7, no spinners): the header, then the form card. */
export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <Skeleton className="h-[640px] max-w-3xl rounded-xl" aria-busy="true" aria-label="Loading" />
    </div>
  );
}
