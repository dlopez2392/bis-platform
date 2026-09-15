// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.tsx
//
// The To do queue's own row rendering (Work Queue Task 3 built the read-only
// shell; Task 4 wires the Not now / Done / booking-outcome buttons via
// `WorkRowActions`, a small "use client" boundary — this file itself stays a
// server component). `visibleBuckets` is its own exported pure function, not
// a `.filter()` inlined in the component below, so a regression back to
// rendering an empty heading for a bucket with no rows is something a test
// can catch by name (page.test.ts) rather than by reading rendered output.
import Link from "next/link";
import type { WorkRow, WorkSource } from "@bis/db";
import { ListTodo } from "lucide-react";
import type { Bucket, BucketedWork } from "@/lib/work/buckets";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { formatDateInZone } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
  completeWorkTask, reopenWorkTask, dismissToTask, closeOutBooking,
  type ActionResult, type DismissResult,
} from "./actions";
import { WorkRowActions } from "./work-row-actions";

/** The four Task 4 actions, bound to one `accountId` by `WorkList` and
 *  threaded down through `WorkRowItem` into the "use client" boundary. */
type WorkActionProps = {
  completeWorkTask: (taskId: string) => Promise<ActionResult>;
  reopenWorkTask: (taskId: string) => Promise<ActionResult>;
  dismissToTask: (row: { source: WorkSource; contactId: string | null; title: string }) => Promise<DismissResult>;
  closeOutBooking: (bookingId: string, status: "completed" | "no_show") => Promise<ActionResult>;
};

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

/**
 * The epoch INSTANT `listAccountWork`'s conversation branch falls back to
 * when a conversation has no `last_message_at` yet
 * (packages/db/src/work-queue.ts:71: `new Date(0).toISOString()`) —
 * reachable in production, not just theoretical: the conversation touch in
 * messaging.ts is deliberately best-effort and the unread-increment path
 * never sets that column at all. Printing "Jan 1, 1970" (or, in a
 * negative-offset zone, "Dec 31, 1969") next to a row would read as a real,
 * wildly-stale date rather than "we don't know" — so a row whose only
 * available timestamp resolves to this instant gets no date text at all.
 * Compared against the PARSED instant below, not one exact sentinel string,
 * so a non-canonical spelling of the same moment (no milliseconds, or a null)
 * degrades the same way — neither is reachable from today's schema, but
 * matching the instant instead of one string closes both for free. Fixed
 * here, in the UI, rather than in `work-queue.ts`, which is Task 1's
 * already-reviewed code.
 */
const EPOCH_MS = 0;

/**
 * The row's own date, in the ACCOUNT's zone — never the server's, never the
 * browser's (the milestone's binding constraint). `formatDateInZone` throws
 * `RangeError` on an unparseable timestamp or an invalid zone; the degrade
 * requirement this screen inherits (commit 3649d41, `bucketWork`'s own
 * per-row degrade on a bad `dueAt`) means a single bad row must not take the
 * whole page down, so that throw costs at most this row's own date text —
 * narrowed the same way `bucketWork`'s own two `catch` blocks are narrowed:
 * rethrow anything that is NOT a `RangeError`, so a real bug in the format
 * path fails loudly instead of silently going blank on every row forever.
 */
function rowDateText(row: WorkRow, timezone: string): string | null {
  const iso = row.dueAt ?? row.occurredAt;
  if (new Date(iso).getTime() === EPOCH_MS) return null;
  try {
    return formatDateInZone(iso, timezone);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

/** `WorkRow.id` is `\`${source}:${dbId}\`` (work-queue.ts) — every mutation
 *  below (`completeTask`, `addTask`'s suppression target, `setBookingStatus`)
 *  wants the bare database id, never the prefixed one. */
function rawRowId(row: WorkRow): string {
  return row.id.slice(row.source.length + 1);
}

function WorkRowItem({
  row,
  bucket,
  accountId,
  contactName,
  timezone,
  actions,
}: {
  row: WorkRow;
  bucket: Bucket;
  accountId: string;
  /** Never a raw id and never "undefined" — WorkList resolves this to
   *  `m["contact.noName"]` for a contactId with no matching (or no) row. */
  contactName: string;
  /** The account's own RAW IANA zone, exactly as page.tsx read it off the
   *  account row — never `safeZone`-clamped to UTC (see page.tsx's own
   *  comment on this). Every date on this row is the company's own
   *  wall-clock day — the bucket chip beside it is computed in this same raw
   *  zone by `bucketWork`, and a row formatted in a different zone (the
   *  server's, via the bare `formatDate` this replaced, or a UTC clamp)
   *  could disagree with its own chip inside a single row. `rowDateText`
   *  above is what actually declines on an invalid zone, per-row. */
  timezone: string;
  /** The four Task 4 server actions, already bound to `accountId` by
   *  `WorkList` below — passed down as props into the "use client" boundary
   *  (`WorkRowActions`) rather than imported there directly, matching
   *  `bookings-list.tsx`'s own precedent for a client list under a server
   *  page. */
  actions: WorkActionProps;
}) {
  const treatment = BUCKET_TREATMENT[bucket];
  const primary = primaryLabel(row, contactName);
  const secondary = secondaryLine(row, contactName);
  const dateText = rowDateText(row, timezone);

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
      {dateText ? (
        <span className="shrink-0 text-xs text-muted-foreground">{dateText}</span>
      ) : null}
    </>
  );

  const rowClassName = "flex items-center gap-3 px-4 py-3 text-sm transition-colors";

  // Only a row tied to a real contact has anywhere to go — a contact-less
  // task (no `contact_id` on the `tasks` row) renders the same content as a
  // plain, non-interactive row rather than a link to nowhere.
  //
  // The `<li>` is now the flex row (Task 4): the informational Link/div
  // shrinks to `min-w-0 flex-1` beside the action buttons rather than the
  // buttons nesting INSIDE the Link — a `<button>` inside an `<a>` is
  // invalid markup and makes a click ambiguous between "navigate" and "act".
  // `body` itself (the date/badge/label spans above) is untouched.
  return (
    <li className={cn(LIST_ROW, "flex items-center")}>
      {row.contactId ? (
        <Link
          href={`/dashboard/accounts/${accountId}/contacts/${row.contactId}`}
          className={cn(rowClassName, "min-w-0 flex-1", "hover:bg-[var(--surface-3)]")}
        >
          {body}
        </Link>
      ) : (
        <div className={cn(rowClassName, "min-w-0 flex-1")}>{body}</div>
      )}
      <div className="pr-4">
        <WorkRowActions
          source={row.source}
          rawId={rawRowId(row)}
          contactId={row.contactId}
          label={primary}
          completeWorkTask={actions.completeWorkTask}
          reopenWorkTask={actions.reopenWorkTask}
          dismissToTask={actions.dismissToTask}
          closeOutBooking={actions.closeOutBooking}
        />
      </div>
    </li>
  );
}

export function WorkList({
  buckets,
  accountId,
  contactNames,
  timezone,
}: {
  buckets: BucketedWork;
  accountId: string;
  /** contactId → display name, for every non-null contactId across every
   *  bucket — ONE batch read (page.tsx), never one per row. A contactId
   *  absent from this map (a deleted, or otherwise missing, contact) falls
   *  back to `m["contact.noName"]` below — never a raw id, never
   *  "undefined". */
  contactNames: Record<string, string>;
  /** The account's own RAW IANA zone, read straight off the account row by
   *  page.tsx with no `safeZone` clamp — UNLIKE `calls-table.tsx`'s
   *  identically-named prop. A bad zone must be OMITTED, never guessed at in
   *  UTC (page.tsx's own comment), so this screen's contract differs from
   *  Calls' on purpose. Threaded straight through to every row's own date
   *  text, which is where the actual per-row decline happens. */
  timezone: string;
}) {
  const shown = visibleBuckets(buckets);

  if (shown.length === 0) {
    return <EmptyState icon={ListTodo} title={m["work.empty"]} body={m["work.empty.body"]} />;
  }

  // Bound to THIS account once, here — the same shape as
  // `calendar/page.tsx`'s `boundSetStatus` — so every row's client-side
  // action button below is a plain `(id) => Promise<Result>` with no
  // `accountId` of its own to get wrong.
  const actions: WorkActionProps = {
    completeWorkTask: completeWorkTask.bind(null, accountId),
    reopenWorkTask: reopenWorkTask.bind(null, accountId),
    dismissToTask: dismissToTask.bind(null, accountId),
    closeOutBooking: closeOutBooking.bind(null, accountId),
  };

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
                timezone={timezone}
                actions={actions}
              />
            ))}
          </ListPanel>
        </section>
      ))}
    </div>
  );
}
