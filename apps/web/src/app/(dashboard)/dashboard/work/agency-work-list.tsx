// apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.tsx
//
// The agency-wide queue's own row rendering (Work Queue Task 6). Deliberately
// its own file rather than an import from tasks/work-list.tsx: that file's
// `BUCKET_TREATMENT`/`primaryLabel`/`secondaryLine`/`rowDateText` are not
// exported (only `visibleBuckets` and `WorkList` are, per its own header
// comment), and it belongs to a different route. The visual language below
// is the SAME one deliberately — same badge, same row shape, same three
// bucket headings — restated here rather than reached into, per the task-6
// brief's own instruction to follow that screen's conventions rather than
// invent a second visual language for the same rows.
//
// Two things differ from the per-account `WorkList`, both because THIS
// screen pools rows across every account on one page instead of scoping to
// one:
//   - There is no single shared `accountId`/`timezone` prop. Every row is
//     its own `AgencyWorkRow`, already carrying its OWN `accountId` and
//     `timezone` (`listAgencyWork`'s own row shape) — every link and every
//     rendered date reads those straight off the row, so an agency user
//     never sees another account's zone-computed date leak onto this one's
//     row, and never lands on another account's contact.
//   - No action buttons. The per-account "To do" screen's Not now / Done /
//     booking buttons are bound to ONE accountId (tasks/actions.ts); wiring
//     the same actions per-row across many accounts is a bigger surface than
//     this task's own brief asks for ("render grouped with the brand name on
//     every row" — nothing about acting from here). A row here is read-only;
//     acting on it means following its own link into that account.
import Link from "next/link";
import { ListTodo } from "lucide-react";
import type { AgencyWorkRow } from "@bis/db";
import type { Bucket } from "@/lib/work/buckets";
import type { AgencyBucketedWork } from "@/lib/work/agency-buckets";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { formatDateInZone } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";

const BUCKET_ORDER: Bucket[] = ["overdue", "today", "waiting"];

/** Same shape as tasks/work-list.tsx's `visibleBuckets` — a bucket with zero
 *  rows renders NOTHING, not an empty heading. */
export function visibleAgencyBuckets(b: AgencyBucketedWork): Bucket[] {
  return BUCKET_ORDER.filter((key) => b[key].length > 0);
}

/** Restated from tasks/work-list.tsx's own (unexported) `BUCKET_TREATMENT` —
 *  see this file's header comment for why it is not imported instead. */
const BUCKET_TREATMENT: Record<Bucket, { dot: string; chip: string; labelKey: MessageKey }> = {
  overdue: {
    dot: "bg-[var(--crit)]",
    chip: "border-transparent bg-[var(--crit-bg)] text-[var(--crit)]",
    labelKey: "work.bucket.overdue",
  },
  today: {
    dot: "bg-[var(--warn)]",
    chip: "border-transparent bg-[var(--warn-bg)] text-[var(--warn)]",
    labelKey: "work.bucket.today",
  },
  waiting: {
    dot: "bg-muted-foreground/60",
    chip: "border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--chip-text)]",
    labelKey: "work.bucket.waiting",
  },
};

function primaryLabel(row: AgencyWorkRow, contactName: string): string {
  if (row.source === "task") return row.title;
  if (row.source === "conversation") return m["work.conversation"].replace("{name}", () => contactName);
  return m["work.booking"];
}

function secondaryLine(row: AgencyWorkRow, contactName: string): string | null {
  if (row.source === "conversation") return row.title || null;
  return row.contactId ? contactName : null;
}

/** Same epoch sentinel as tasks/work-list.tsx's own `EPOCH_MS` — see that
 *  file's doc comment for why a conversation with no `last_message_at` yet
 *  must render no date rather than "Jan 1, 1970". */
const EPOCH_MS = 0;

/**
 * The row's own date, in ITS OWN account's zone — read off `row.timezone`,
 * never a prop shared across every row on this page (unlike the per-account
 * screen, where every row genuinely is the same account). Degrades to no
 * date text, never a UTC guess, on either an invalid zone or an unparseable
 * timestamp — the task-6 brief states this constraint as binding on the
 * whole route, not only the bucketing function, and a row here is the
 * clearest place it can be violated: a per-row zone that only THIS row
 * carries is easy to silently drop in favour of some other zone in scope.
 */
function rowDateText(row: AgencyWorkRow): string | null {
  const iso = row.dueAt ?? row.occurredAt;
  if (new Date(iso).getTime() === EPOCH_MS) return null;
  try {
    return formatDateInZone(iso, row.timezone);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

function AgencyWorkRowItem({
  row,
  bucket,
  contactName,
}: {
  row: AgencyWorkRow;
  bucket: Bucket;
  /** Never a raw id and never "undefined" — AgencyWorkList resolves this to
   *  m["contact.noName"] for a contactId with no matching (or no) row. */
  contactName: string;
}) {
  const treatment = BUCKET_TREATMENT[bucket];
  const primary = primaryLabel(row, contactName);
  const secondary = secondaryLine(row, contactName);
  const dateText = rowDateText(row);

  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* The brand name, on every row — spec §4.2 / task-6-brief.md. Label
            type role (DESIGN.md: Geist Mono 500, 10px, +0.14em, uppercase),
            the same treatment the bucket headings below already use, so it
            reads as a caption identifying which company this row belongs
            to, never as the row's own status or title. */}
        <span className="truncate font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {row.brandName}
        </span>
        <span className="truncate text-sm font-medium text-card-foreground">{primary}</span>
        {secondary ? <span className="truncate text-xs text-muted-foreground">{secondary}</span> : null}
      </span>
      <Badge variant="chip" className={cn("shrink-0 gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
        <span className={cn("size-[7px] rounded-full", treatment.dot)} aria-hidden />
        {m[treatment.labelKey]}
      </Badge>
      {dateText ? (
        <span className="shrink-0 text-xs text-muted-foreground">{dateText}</span>
      ) : null}
    </>
  );

  const rowClassName = "flex w-full items-center gap-3 px-4 py-3 text-sm";

  // Only a row tied to a real contact has anywhere to go, and it goes into
  // THAT row's own account (`row.accountId`) — never a single accountId
  // shared by the whole list, unlike the per-account screen's WorkRowItem.
  return (
    <li className={cn(LIST_ROW, "flex items-center transition-colors hover:bg-[var(--surface-3)]")}>
      {row.contactId ? (
        <Link href={`/dashboard/accounts/${row.accountId}/contacts/${row.contactId}`} className={rowClassName}>
          {body}
        </Link>
      ) : (
        <div className={rowClassName}>{body}</div>
      )}
    </li>
  );
}

export function AgencyWorkList({
  buckets,
  contactNames,
}: {
  buckets: AgencyBucketedWork;
  /** contactId → display name, for every non-null contactId across every
   *  bucket and every account — ONE batch read (page.tsx), never one per
   *  row and never one per account. A contactId absent from this map falls
   *  back to m["contact.noName"] below — never a raw id, never
   *  "undefined". */
  contactNames: Record<string, string>;
}) {
  const shown = visibleAgencyBuckets(buckets);

  if (shown.length === 0) {
    return <EmptyState icon={ListTodo} title={m["work.empty"]} body={m["work.agency.empty.body"]} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {shown.map((bucket) => (
        <section key={bucket} className="flex flex-col gap-2">
          <h2 className="px-1 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {m[BUCKET_TREATMENT[bucket].labelKey]}
          </h2>
          <ListPanel as="ul">
            {buckets[bucket].map((row) => (
              <AgencyWorkRowItem
                key={row.id}
                row={row}
                bucket={bucket}
                contactName={contactNames[row.contactId ?? ""] ?? m["contact.noName"]}
              />
            ))}
          </ListPanel>
        </section>
      ))}
    </div>
  );
}
