// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.tsx
//
// The To do queue's own row rendering (Work Queue Task 3, READ-ONLY — Task 4
// wires the Not now / Done / booking-outcome buttons; nothing rendered here
// is a mutation). `visibleBuckets` is its own exported pure function, not a
// `.filter()` inlined in the component below, so a regression back to
// rendering an empty heading for a bucket with no rows is something a test
// can catch by name (page.test.ts) rather than by reading rendered output.
import Link from "next/link";
import type { WorkRow } from "@bis/db";
import { ListTodo } from "lucide-react";
import type { Bucket, BucketedWork } from "@/lib/work/buckets";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { formatDate } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";

const BUCKET_ORDER: Bucket[] = ["overdue", "today", "waiting"];

/** Which of the three buckets actually have rows, in display order. A
 *  bucket with zero rows renders NOTHING, not an empty heading — the whole
 *  point this helper exists to make testable on its own (see page.test.ts's
 *  doc comment on the brief's own, un-failable version of this check). */
export function visibleBuckets(b: BucketedWork): Bucket[] {
  return BUCKET_ORDER.filter((key) => b[key].length > 0);
}

/**
 * Per-row status treatment — DESIGN.md rule 3 (status is never colour alone:
 * dot + word), applied at the ROW level and not only the section heading
 * above it: the Waiting bucket mixes conversations, bookings and any task
 * whose due date has already rolled past, so a row scrolled away from its
 * heading still carries its own status. Deliberately reuses the SAME three
 * `work.bucket.*` copy keys as the section headings: a row's status IS which
 * bucket it is in, nothing more, so a second vocabulary would only be
 * something else to keep in sync with `buckets.ts`.
 */
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

/**
 * The row's own primary sentence. A task's title is already human-written
 * (`WorkRow.title`'s own doc comment in packages/db/src/work-queue.ts) — shown
 * verbatim, never re-templated. A derived row has no author, so its sentence
 * comes from the copy catalogue: a replacer FUNCTION for the conversation
 * case, not a plain string second argument to `.replace` — matching
 * dashboard/page.tsx's own greeting, because `String.replace` treats a
 * string pattern specially (`$&`, `$1`…) and a contact's own name is
 * untrusted input that could contain one.
 */
function primaryLabel(row: WorkRow, contactName: string): string {
  if (row.source === "task") return row.title;
  if (row.source === "conversation") return m["work.conversation"].replace("{name}", () => contactName);
  return m["work.booking"];
}

/**
 * The row's secondary line. A conversation's own title IS the latest call's
 * summary (or "" with no call yet) — shown here instead of the name, which
 * `work.conversation`'s primary sentence already carries. `work.booking`'s
 * bare question carries no {name} of its own, so task and booking rows show
 * the contact here instead — the copy rule behind this whole namespace is
 * that a row names the person somewhere, and this is where task/booking do.
 */
function secondaryLine(row: WorkRow, contactName: string): string | null {
  if (row.source === "conversation") return row.title || null;
  return row.contactId ? contactName : null;
}

function WorkRowItem({
  row,
  bucket,
  accountId,
  contactName,
}: {
  row: WorkRow;
  bucket: Bucket;
  accountId: string;
  /** Never a raw id and never "undefined" — WorkList resolves this to
   *  `m["contact.noName"]` for a contactId with no matching (or no) row. */
  contactName: string;
}) {
  const treatment = BUCKET_TREATMENT[bucket];
  const primary = primaryLabel(row, contactName);
  const secondary = secondaryLine(row, contactName);
  const dateText = formatDate(row.dueAt ?? row.occurredAt);

  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-card-foreground">{primary}</span>
        {secondary ? <span className="truncate text-xs text-muted-foreground">{secondary}</span> : null}
      </span>
      <Badge variant="chip" className={cn("shrink-0 gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
        <span className={cn("size-[7px] rounded-full", treatment.dot)} aria-hidden />
        {m[treatment.labelKey]}
      </Badge>
      <span className="shrink-0 text-xs text-muted-foreground">{dateText}</span>
    </>
  );

  const rowClassName = "flex items-center gap-3 px-4 py-3 text-sm transition-colors";

  // Only a row tied to a real contact has anywhere to go — a contact-less
  // task (no `contact_id` on the `tasks` row) renders the same content as a
  // plain, non-interactive row rather than a link to nowhere.
  return (
    <li className={LIST_ROW}>
      {row.contactId ? (
        <Link
          href={`/dashboard/accounts/${accountId}/contacts/${row.contactId}`}
          className={cn(rowClassName, "hover:bg-[var(--surface-3)]")}
        >
          {body}
        </Link>
      ) : (
        <div className={rowClassName}>{body}</div>
      )}
    </li>
  );
}

export function WorkList({
  buckets,
  accountId,
  contactNames,
}: {
  buckets: BucketedWork;
  accountId: string;
  /** contactId → display name, for every non-null contactId across every
   *  bucket — ONE batch read (page.tsx), never one per row. A contactId
   *  absent from this map (a deleted, or otherwise missing, contact) falls
   *  back to `m["contact.noName"]` below — never a raw id, never
   *  "undefined". */
  contactNames: Record<string, string>;
}) {
  const shown = visibleBuckets(buckets);

  if (shown.length === 0) {
    return <EmptyState icon={ListTodo} title={m["work.empty"]} />;
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
              <WorkRowItem
                key={row.id}
                row={row}
                bucket={bucket}
                accountId={accountId}
                contactName={contactNames[row.contactId ?? ""] ?? m["contact.noName"]}
              />
            ))}
          </ListPanel>
        </section>
      ))}
    </div>
  );
}
