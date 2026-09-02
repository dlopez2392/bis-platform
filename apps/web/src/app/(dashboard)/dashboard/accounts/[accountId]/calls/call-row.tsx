"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

/**
 * The one client boundary in the calls table: whole-row open + keyboard nav
 * (DESIGN.md rule 4). Cells stay server-rendered children. Inner links
 * (the caller's contact link) must stopPropagation — see calls-table.tsx.
 */
export function CallRow({ href, label, children }: {
  href: string; label: string; children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <TableRow
      tabIndex={0}
      aria-label={label}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(href); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const sibling = e.key === "ArrowDown"
            ? e.currentTarget.nextElementSibling
            : e.currentTarget.previousElementSibling;
          if (sibling instanceof HTMLElement) sibling.focus();
        }
      }}
      className="group cursor-pointer focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
    >
      {children}
    </TableRow>
  );
}

export function StopPropagation({ children }: { children: React.ReactNode }) {
  return <span onClick={(e) => e.stopPropagation()}>{children}</span>;
}
