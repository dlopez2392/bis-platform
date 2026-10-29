"use client";

import { AGENCY_VISIT_REASONS, type AgencyVisitReason } from "@bis/db";
import { ReasonTiles } from "@/components/access-log/reason-tiles";
import { BisAccessList } from "@/components/access-log/bis-access-list";
import { BisAccessSkeleton } from "@/components/access-log/bis-access-skeleton";
import { BisAccessError } from "@/components/access-log/bis-access-error";
import { LocaleProvider } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import type { VisitRowView } from "@/lib/access-log/view";

/**
 * F-118 part 1 (plan Task 4, step 5): the chooser's reason tiles and the Owner's "BIS access" row,
 * skeleton and error state. `BisAccessFrame` is not demonstrated here on purpose — the demo is the
 * ROW kit (list/skeleton/error), the frame's own copy is already pinned by `access-log-components.test.ts`,
 * and a second, invented intro/notes block here would only repeat what that test already proves.
 */
const REASON_KEY: Record<AgencyVisitReason, "accessLog.reason.setup" | "accessLog.reason.support" | "accessLog.reason.fix" | "accessLog.reason.billing"> = {
  setup: "accessLog.reason.setup", support: "accessLog.reason.support", fix: "accessLog.reason.fix", billing: "accessLog.reason.billing",
};
const REASON_OPTIONS = AGENCY_VISIT_REASONS.map((value) => ({ value, label: m[REASON_KEY[value]] }));

/** Fixture rows as JS constants (plan step 5), not JSX literals, shaped like `buildVisitRows`'s own
 *  output — one visit with every kind of item, one with nothing opened. */
const ROWS: VisitRowView[] = [
  {
    id: "sg-visit-open",
    label: "Dan Lopez · Support request",
    when: "Oct 29, 2026, 2:10 PM–2:25 PM",
    summary: "Opened 4 customers, 1 call and 1 file.",
    items: [
      { key: "contact-c1", text: "Customer · Maria Lopez", href: "#" },
      { key: "call-call1", text: "Call · Maria Lopez · Oct 28, 2026, 3:04 PM", href: "#" },
      { key: "document_view-doc1", text: "File · Insurance card · viewed", href: "#" },
      { key: "contact-c2", text: "A customer who was later deleted", href: null },
    ],
    more: "and 37 more",
  },
  {
    id: "sg-visit-empty",
    label: "Someone at BIS · Fixing a problem",
    when: "Oct 27, 2026, 9:02 AM",
    summary: "Didn't open any customer, call, conversation or file.",
    items: [],
    more: null,
  },
];

const TILES_CAPTION = "components/access-log/reason-tiles.tsx";
const LIST_CAPTION = "components/access-log/bis-access-list.tsx";
const SKELETON_CAPTION = "components/access-log/bis-access-skeleton.tsx";
const ERROR_CAPTION = "components/access-log/bis-access-error.tsx";

export function BisAccessDemo() {
  return (
    <LocaleProvider locale="en">
      <div className="grid w-full gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{TILES_CAPTION}</p>
          <form onSubmit={(e) => e.preventDefault()}>
            <ReasonTiles legend={m["accessLog.enter.legend"]} options={REASON_OPTIONS} />
          </form>
        </div>
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{LIST_CAPTION}</p>
          <BisAccessList rows={ROWS} />
        </div>
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{SKELETON_CAPTION}</p>
          <BisAccessSkeleton />
        </div>
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{ERROR_CAPTION}</p>
          <BisAccessError />
        </div>
      </div>
    </LocaleProvider>
  );
}
