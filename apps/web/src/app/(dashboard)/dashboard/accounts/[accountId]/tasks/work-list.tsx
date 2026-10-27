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
import { Inbox, ListTodo } from "lucide-react";
import type { Bucket, BucketedWork } from "@/lib/work/buckets";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { formatDateInZone } from "@/lib/format";
import { workRowHref } from "@/lib/documents/card-focus";
import { m, type MessageKey } from "@/lib/messages";
import { plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import {
  completeWorkTask, reopenWorkTask, dismissToTask, closeOutBooking,
  confirmStopFromTask, notAStopFromTask, undoHoldDecisionFromTask,
  type ActionResult, type DismissResult,
} from "./actions";
import { WorkRowActions } from "./work-row-actions";
import { ConsentHoldActions } from "./consent-hold-actions";
import type { TextsActionResult } from "@/lib/consent/staff-actions";
import { AiAuthorMark } from "../calls/ai-author-mark";
import { SuggestionSection } from "@/components/proposals/suggestion-section";
import type { SuggestionGroup } from "@/lib/proposals/group";
import {
  acceptSuggestionAction, editAcceptSuggestionAction, discardSuggestionAction, undoSuggestionAction,
} from "@/lib/proposals/actions";
import type { Tr } from "@/lib/record/copy";
import type { AssignMember } from "@/lib/assign/view";
import type { Who } from "@/lib/assign/who";
import { TaskAssigneeField } from "@/components/assign/assignee-field";

/** The four Task 4 actions, bound to one `accountId` by `WorkList` and
 *  threaded down through `WorkRowItem` into the "use client" boundary. */
type WorkActionProps = {
  completeWorkTask: (taskId: string) => Promise<ActionResult>;
  reopenWorkTask: (taskId: string) => Promise<ActionResult>;
  dismissToTask: (row: { source: WorkSource; contactId: string | null; title: string }) => Promise<DismissResult>;
  closeOutBooking: (bookingId: string, status: "completed" | "no_show") => Promise<ActionResult>;
  confirmStopFromTask: (taskId: string) => Promise<TextsActionResult>;
  notAStopFromTask: (taskId: string) => Promise<TextsActionResult>;
  undoHoldDecisionFromTask: (contactId: string, eventId: string, reopenTaskIds: string[]) => Promise<TextsActionResult>;
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
 * comes from the copy catalogue, in the reader's own language (`tr`, F-085
 * follow-up Task B) — `tr.text`'s own interpolate() already uses a replacer
 * FUNCTION, never a plain string second argument to `.replace`, for the
 * conversation case: a contact's own name is untrusted input that could
 * contain a `$&`/`$1` pattern `String.replace` would treat specially.
 */
function primaryLabel(row: WorkRow, contactName: string, tr: Tr): string {
  if (row.source === "task") return row.title;
  if (row.source === "conversation") return tr.text("work.conversation", { name: contactName });
  return tr.text("work.booking");
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
 * A row's own date, in the account's resolved zone — never the server's,
 * never the browser's (the milestone's binding constraint).
 *
 * THE ZONE CAN NO LONGER CAUSE AN OMISSION (2026-09-18). `timezone` now
 * arrives from `renderZone`, which is total by construction and always hands
 * back a zone `Intl` accepts, so the branch that used to swallow a bad zone
 * and render no date is gone. That omission was the work queue's half of the
 * timezone defect — the other four screens guessed silently, this one went
 * quiet — and danlo's call on 2026-09-17 was explicit: "I do not want to omit
 * the dates." The screen names the zone instead (`ZoneNote`, page.tsx).
 *
 * The `catch` stays, and it is NOT dead code: it now guards exactly one
 * remaining case, an unparseable `iso`, where `formatDateInZone` throws on
 * the INSTANT rather than on the zone. A row with a corrupt timestamp still
 * degrades to no date rather than taking the whole queue down with it.
 */
function rowDateText(row: WorkRow, timezone: string): string | null {
  const iso = row.dueAt ?? row.occurredAt;
  if (new Date(iso).getTime() === EPOCH_MS) return null;
  try {
    return formatDateInZone(iso, timezone);
  } catch (err) {
    // A bad INSTANT only — the zone is guaranteed usable by `renderZone`.
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

/** The row's link (or plain div): the whole first line below md, the old
 *  `min-w-0 flex-1` from md up (`grow` + `md:basis-0` is `flex-1` without
 *  the shorthand's own basis fighting `basis-full`). */
const LINK_SIZE = "min-w-0 grow basis-full md:basis-0";

function WorkRowItem({
  row,
  bucket,
  accountId,
  contactName,
  timezone,
  actions,
  assign,
  tr,
}: {
  row: WorkRow;
  bucket: Bucket;
  accountId: string;
  /** Never a raw id and never "undefined" — WorkList resolves this to
   *  `tr.text("contact.noName")` for a contactId with no matching (or no) row. */
  contactName: string;
  /** The account's RESOLVED zone (`renderZone`), exactly as page.tsx
   *  resolved it. Every date on this row is the company's own wall-clock day
   *  — the bucket chip beside it is computed by `bucketWork` in this SAME
   *  zone, which is what stops a row from disagreeing with its own chip.
   *  Always usable, so `rowDateText` above no longer declines on zone
   *  grounds; page.tsx's `ZoneNote` names the zone once for the screen. */
  timezone: string;
  /** The four Task 4 server actions, already bound to `accountId` by
   *  `WorkList` below — passed down as props into the "use client" boundary
   *  (`WorkRowActions`) rather than imported there directly, matching
   *  `bookings-list.tsx`'s own precedent for a client list under a server
   *  page. */
  actions: WorkActionProps;
  /** F-085 part 1: present only for someone who may hand tasks on. */
  assign: { members: AssignMember[] } | null;
  /** The section's words in the reader's language (F-085 follow-up, Task B) — the SAME `tr` WorkList
   *  already carries for the suggestions tray, now reused for the row's own copy instead of a bare `m[...]`. */
  tr: Tr;
}) {
  const treatment = BUCKET_TREATMENT[bucket];
  const primary = primaryLabel(row, contactName, tr);
  const secondary = secondaryLine(row, contactName);
  // DESIGN.md, Provenance: a callback To do a call left (`callId`, 0064) is
  // the receptionist's, and says so beside the person it is about, as its
  // own mark. A To do a person typed carries no mark here, as before.
  const fromCall = row.source === "task" && Boolean(row.callId);
  const dateText = rowDateText(row, timezone);

  const body = (
    <>
      {/* Phone width (below md): this column takes the whole first line and
          its words WRAP; the chip and date wrap onto the line under it. From
          md up it is the old one-line `flex-1` (grow + basis 0) and truncates.
          `grow basis-*` rather than `flex-1`, because `flex-1` sets the basis
          itself and would fight `basis-full`. */}
      <span data-work-row-text className="flex min-w-0 grow basis-full flex-col gap-0.5 md:basis-0">
        <span data-work-row-title className="break-words text-sm font-medium text-card-foreground md:truncate">{primary}</span>
        {secondary || fromCall ? (
          <span className="flex min-w-0 items-center gap-2">
            {secondary ? <span className="min-w-0 break-words text-xs text-muted-foreground md:truncate">{secondary}</span> : null}
            {fromCall ? <AiAuthorMark /> : null}
          </span>
        ) : null}
      </span>
      <Badge data-work-row-chip variant="chip" className={cn("shrink-0 gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
        <span className={cn("size-[7px] rounded-full", treatment.dot)} aria-hidden />
        {tr.text(treatment.labelKey)}
      </Badge>
      {dateText ? (
        <span data-work-row-date className="shrink-0 text-xs text-muted-foreground">{dateText}</span>
      ) : null}
    </>
  );

  // The phone-width defect (owner's screenshot, 2026-10-20): this was one
  // non-wrapping line, and the link it sits in is `min-w-0` beside the
  // assignee picker and Done. At ~390px the link was narrower than its two
  // `shrink-0` children (chip, date) alone, so the `min-w-0 flex-1` title
  // column shrank to zero width — the title and contact vanished — and the
  // chip and date overflowed the link onto the assignee picker. Below md the
  // link now takes the row's whole first line and wraps its own content
  // (title, then chip and date); the assignee and Done wrap onto the next
  // line. From md up every `md:` class restores the one-line row.
  const rowClassName = "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2 text-sm md:flex-nowrap md:py-3";
  // S-07 3a: an expiry To-do links to its file (workRowHref).
  const href = workRowHref(accountId, row);

  // Only a row tied to a real contact has anywhere to go — a contact-less
  // task (no `contact_id` on the `tasks` row) renders the same content as a
  // plain, non-interactive row rather than a link to nowhere.
  //
  // The `<li>` is now the flex row (Task 4): the informational Link/div
  // shrinks to `min-w-0 flex-1` beside the action buttons rather than the
  // buttons nesting INSIDE the Link — a `<button>` inside an `<a>` is
  // invalid markup and makes a click ambiguous between "navigate" and "act".
  // `body` itself (the date/badge/label spans above) is untouched.
  //
  // The hover background lives on the `<li>` itself, not on the inner
  // Link/div: DESIGN.md rule 4 wants the WHOLE row to carry the hover, and
  // `LIST_ROW` supplies only a border. With the highlight on the Link alone
  // it stopped short of the right edge on every row — the actions column's
  // own padding and the gap between the two booking buttons read as dead
  // strips, and hovering a button lit its own small rectangle disconnected
  // from the row — and a contact-less row (the plain `<div>` branch) had no
  // hover treatment at all. Putting `hover:bg-[var(--surface-3)]` on the
  // `<li>` covers the full row — informational side AND actions side —
  // regardless of which branch renders inside it.
  return (
    <li data-work-row className={cn(LIST_ROW, "flex flex-wrap items-center transition-colors hover:bg-[var(--surface-3)] md:flex-nowrap")}>
      {href ? (
        <Link
          data-work-row-link
          href={href}
          className={cn(rowClassName, LINK_SIZE)}
        >
          {body}
        </Link>
      ) : (
        <div data-work-row-link className={cn(rowClassName, LINK_SIZE)}>{body}</div>
      )}
      <div
        data-work-row-actions
        className="flex min-w-0 basis-full items-center gap-2 pr-4 pb-2 pl-2.5 md:basis-auto md:gap-0 md:pb-0 md:pl-0"
      >
        {/* F-085 part 1 (spec §9): a task's own holder, an inline pick with an
            Undo toast, beside the link rather than inside it (a control in an
            <a> is invalid markup). A conversation or booking has no holder of
            its own: it is the customer's, set on the customer. */}
        {assign && row.source === "task" ? (
          <div className="min-w-0 max-w-[10rem] shrink">
            <TaskAssigneeField
              key={`${row.id}:${row.assigneeId ?? ""}`}
              accountId={accountId}
              taskId={rawRowId(row)}
              value={row.assigneeId ?? null}
              options={assign.members}
            />
          </div>
        ) : null}
        {/* On a phone Done sits at the line's right end, as it does on desktop. */}
        <div className="ml-auto shrink-0 md:ml-0">
          {/* A hold's To-do is decided, not ticked off (spec §6): its two
              buttons replace Done. A CANCEL To-do keeps Done. */}
          {row.consent?.action === "held" ? (
            <ConsentHoldActions
              taskId={rawRowId(row)}
              contactId={row.contactId}
              confirm={actions.confirmStopFromTask}
              release={actions.notAStopFromTask}
              undo={actions.undoHoldDecisionFromTask}
            />
          ) : (
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
          )}
        </div>
      </div>
    </li>
  );
}

const NO_SUGGESTIONS = { groups: [], capped: false, error: false };

export function WorkList({
  buckets,
  accountId,
  contactNames,
  timezone,
  suggestions = NO_SUGGESTIONS,
  tr,
  personaName = "Sofía",
  canAssign = false,
  members = [],
  who = "all",
  heldEmails,
}: {
  buckets: BucketedWork;
  accountId: string;
  /** contactId → display name, for every non-null contactId across every
   *  bucket AND every pending proposal — ONE batch read (page.tsx), never
   *  one per row and never one per account. A contactId absent from this map
   *  (a deleted, or otherwise missing, contact) falls back to
   *  `tr.text("contact.noName")` below — never a raw id, never "undefined". */
  contactNames: Record<string, string>;
  /** The account's RESOLVED zone (`renderZone`) — the SAME contract
   *  `calls-table.tsx`'s identically-named prop now carries. This screen
   *  used to differ on purpose (omit rather than guess); it no longer does,
   *  because the guess is no longer silent. One rule, five screens. */
  timezone: string;
  /** The tray (item 8b-1): this account's pending suggestions as cards
   *  (`buildSuggestionView`, page.tsx), grouped by customer, then by call
   *  (`groupSuggestions`, item 8b-2), whether more than 200 came back, and
   *  whether a read behind them failed. A QUESTION about work, never work
   *  itself, so it is NEVER folded into `buckets`/`Bucket` (spec 8.1).
   *  Optional (defaults to none) so every other call site and test is
   *  unaffected. */
  suggestions?: { groups: SuggestionGroup[]; capped: boolean; error: boolean };
  /** The section's words in the reader's language (requestLocale). REQUIRED, never defaulted (final
   *  review, Task 8): a silent English default let a caller that forgot it show a Spanish reader English
   *  cards, and no test could tell. */
  tr: Tr;
  /** The account's persona, for the section's subhead. */
  personaName?: string;
  /** F-085 part 1: may this caller hand tasks to someone (Owner, Staff, the
   *  agency), and to whom: each task row's "Assigned to" picker. */
  canAssign?: boolean;
  members?: AssignMember[];
  /** The Mine / Unassigned filter the page applied, for the empty state. */
  who?: Who;
  /** Task 12 (S-06 part 1): the inbox's own "Needs a look" count, read by
   *  `tasks/page.tsx` once alongside this screen's own buckets — never a
   *  fourth bucket, same reasoning `proposals` already carries above. Only
   *  rendered at count > 0 (an unknown count, read-failure included, omits
   *  the row rather than showing "0 emails need a look"). */
  heldEmails?: { count: number; href: string; locale: Locale };
}) {
  const shown = visibleBuckets(buckets);

  // The one row above everything else on this screen, including the empty
  // state below — a real held email waiting still needs a look even on a
  // day with no other to-dos at all.
  const heldRow = heldEmails && heldEmails.count > 0 ? (
    <Link
      data-held-emails-row
      href={heldEmails.href}
      lang={heldEmails.locale}
      className={cn("flex items-center gap-2 px-3 py-2.5 text-sm", LIST_ROW, "hover:bg-[var(--surface-3)]")}
    >
      <Inbox className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {plural(m, "work.heldEmails", heldEmails.count, heldEmails.locale, { count: heldEmails.count })}
    </Link>
  ) : null;

  // The real queue can be empty while a suggestion still exists, or while
  // the suggestions could not be read: this screen never claims "Nothing
  // needs you right now" over a pending suggestion or over a read it could
  // not make.
  if (shown.length === 0 && suggestions.groups.length === 0 && !suggestions.error) {
    // F-085 part 1: an empty filter is not an empty queue, so it says which.
    if (who === "mine") return <>{heldRow}<EmptyState icon={ListTodo} title={tr.text("assign.empty.mine")} lang={tr.locale} /></>;
    if (who === "unassigned") return <>{heldRow}<EmptyState icon={ListTodo} title={tr.text("assign.empty.unassignedWork")} lang={tr.locale} /></>;
    return <>{heldRow}<EmptyState icon={ListTodo} title={tr.text("work.empty")} body={tr.text("work.empty.body")} lang={tr.locale} /></>;
  }
  const assign = canAssign ? { members } : null;

  // Bound to THIS account once, here — the same shape as
  // `calendar/page.tsx`'s `boundSetStatus` — so every row's client-side
  // action button below is a plain `(id) => Promise<Result>` with no
  // `accountId` of its own to get wrong.
  const actions: WorkActionProps = {
    completeWorkTask: completeWorkTask.bind(null, accountId),
    reopenWorkTask: reopenWorkTask.bind(null, accountId),
    dismissToTask: dismissToTask.bind(null, accountId),
    closeOutBooking: closeOutBooking.bind(null, accountId),
    confirmStopFromTask: confirmStopFromTask.bind(null, accountId),
    notAStopFromTask: notAStopFromTask.bind(null, accountId),
    undoHoldDecisionFromTask: undoHoldDecisionFromTask.bind(null, accountId),
  };

  return (
    <div className="flex flex-col gap-6">
      {heldRow}
      {shown.map((bucket) => (
        // `data-bucket` is a test-only marker (no visual effect), matching
        // the agency screen's own — it lets a render test isolate ONE
        // bucket's own HTML from the proposals section beside it, the same
        // no-contamination proof that screen's binding constraint exists for.
        <section key={bucket} data-bucket={bucket} className="flex flex-col gap-2">
          <h2 className="px-1 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {tr.text(BUCKET_TREATMENT[bucket].labelKey)}
          </h2>
          <ListPanel as="ul">
            {buckets[bucket].map((row) => (
              <WorkRowItem
                key={row.id}
                row={row}
                bucket={bucket}
                accountId={accountId}
                contactName={contactNames[row.contactId ?? ""] ?? tr.text("contact.noName")}
                timezone={timezone}
                actions={actions}
                assign={assign}
                tr={tr}
              />
            ))}
          </ListPanel>
        </section>
      ))}
      {/* A sibling <section>, never a fourth bucket (spec 8.1). Absent when nothing is pending; its
          own error state with Retry when a read behind it failed. Each action is bound to this account
          here, as the row actions above are (plan fix I-3). */}
      <SuggestionSection
        tr={tr}
        personaName={personaName}
        data={suggestions.error ? { ok: false } : { ok: true, groups: suggestions.groups, capped: suggestions.capped }}
        accept={acceptSuggestionAction.bind(null, accountId)}
        editAccept={editAcceptSuggestionAction.bind(null, accountId)}
        discard={discardSuggestionAction.bind(null, accountId)}
        undo={undoSuggestionAction.bind(null, accountId)}
      />
    </div>
  );
}
