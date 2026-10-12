import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type RecordColumn = "who" | "happening" | "have";
export type RecordLayoutColumn = { column: RecordColumn; content: ReactNode };

/** The desk placement of each column (spec §8). Below 1024px of CONTAINER width: one column, DOM order. */
const PLACE: Record<RecordColumn, string> = {
  who: "@min-[1024px]:col-start-1 @min-[1024px]:row-start-2",
  happening: "@min-[1024px]:col-start-2 @min-[1024px]:row-start-2",
  have: "@min-[1024px]:col-start-3 @min-[1024px]:row-start-2",
};

/**
 * The record page's desk (spec §8, C6). DOM order is the phone order. On a desk the columns are
 * PLACED (who | happening | have) without reordering the DOM, so keyboard and screen-reader order
 * keep the page's priority. The "who" column comes last in the DOM, so a skip link leads to it.
 */
export function RecordLayout({ header, columns, skipLabel, lang }: {
  header: ReactNode; columns: RecordLayoutColumn[]; skipLabel: string; lang?: string;
}) {
  return (
    <div data-record-layout lang={lang} className="@container">
      <a href="#record-who"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-[var(--radius-ctl)] focus:bg-[var(--surface-3)] focus:px-3 focus:py-2 focus:text-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {skipLabel}
      </a>
      <div className="grid gap-4 p-6 @min-[1024px]:grid-cols-[320px_minmax(0,1fr)_280px] @min-[1024px]:items-start">
        <div className="min-w-0 @min-[1024px]:col-span-3">{header}</div>
        {columns.map(({ column, content }) => (
          <div key={column} id={`record-${column}`} data-record-column={column}
            tabIndex={column === "who" ? -1 : undefined}
            className={cn("min-w-0 space-y-4 outline-none", PLACE[column])}>
            {content}
          </div>
        ))}
      </div>
    </div>
  );
}
