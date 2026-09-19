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
import type { CallProposal, ContactFieldPayload, WorkRow, WorkSource } from "@bis/db";
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
// Fix-wave Important 3 (task-11-brief): reused, never copied — `STATUS_TREATMENT`
// (Task 7's own dot+word chip map) and `CARD`/`CARD_HEAD` (the same card
// shell the call-detail page's own Suggested-next-steps block and the
// agency work queue's own Suggestions section both already use). Only the
// per-row LABEL-building logic below is restated, matching
// agency-work-list.tsx's own precedent (its header comment explains why: a
// four/five-entry map is not worth reaching across a route boundary for).
import { STATUS_TREATMENT, type ResolvedStage } from "../calls/[callId]/proposals";
import { CARD, CARD_HEAD } from "../calls/[callId]/card";

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

// ── Work Queue Task 11 — pending suggestions on the account's own screen ──
//
// The spec's own "Why": a client who never opens a specific call never
// learns a suggestion exists. `listPendingProposals` (packages/db's own
// per-account accessor, written for exactly this) had no caller anywhere
// until now. Restated from `agency-work-list.tsx`'s own `proposalSummary`
// (its header comment explains why: not worth reaching across a route
// boundary for a four/five-entry map) — this account's own `FIELD_LABEL_KEY`
// copy is identical, and `../calls/[callId]/proposals.tsx`'s own copy is
// the same private map a third time, never exported for exactly this reason.

const PENDING_FIELD_LABEL_KEY: Record<ContactFieldPayload["field"], MessageKey> = {
  firstName: "contacts.firstName", lastName: "contacts.lastName",
  email: "contacts.email", phone: "contacts.phone",
};

/** The proposal's own plain-language sentence — ALWAYS a string, matching
 *  the agency screen's own `proposalSummary` (its own doc comment explains
 *  why an unresolved opportunity_stage pair still shows a row rather than
 *  being dropped: a proposal this screen cannot name in full is still a
 *  proposal that needs a human's attention). */
function pendingProposalSummary(p: CallProposal, stages: Record<string, ResolvedStage>): string {
  if (p.kind === "task") {
    return m["proposals.task.label"].replace("{title}", () => p.payload.title);
  }
  if (p.kind === "contact_field") {
    const fieldLabel = m[PENDING_FIELD_LABEL_KEY[p.payload.field]].toLowerCase();
    return m["proposals.contactField.label"]
      .replace("{field}", () => fieldLabel)
      .replace("{value}", () => p.payload.value);
  }
  const from = stages[p.payload.fromStageId];
  const to = stages[p.payload.toStageId];
  if (!from || !to) return m["proposals.stage.unresolved"];
  let label = m["proposals.stage.label"]
    .replace("{from}", () => from.name)
    .replace("{to}", () => to.name);
  const bypassed = Math.abs(to.position - from.position) - 1;
  if (bypassed === 1) {
    label += " " + m["proposals.stage.skip.one"];
  } else if (bypassed > 1) {
    label += " " + m["proposals.stage.skip.many"].replace("{n}", String(bypassed));
  }
  return label;
}

/** A `task` proposal's own due date, in the account's resolved zone — the
 *  SAME `timezone` prop `WorkList` already threads through every bucket row.
 *  `null` for every non-`task` kind and for a `task` whose `dueAt` is itself
 *  `null` (generate.ts's own forward-window check already rejected anything
 *  that could not be real). */
function pendingProposalDueAtText(p: CallProposal, timezone: string): string | null {
  if (p.kind !== "task" || !p.payload.dueAt) return null;
  try {
    return formatDateInZone(p.payload.dueAt, timezone);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

function PendingProposalRow({
  proposal, accountId, contactName, stageNames, timezone,
}: {
  proposal: CallProposal;
  accountId: string;
  /** `null` when the proposal carries no contact — never rendered, matching
   *  the agency screen's own row. */
  contactName: string | null;
  stageNames: Record<string, ResolvedStage>;
  timezone: string;
}) {
  // Reused, not restated: `STATUS_TREATMENT` is Task 7's own dot+word map.
  // Always resolves to `pending` here in practice — `listPendingProposals`
  // only ever returns pending rows — but reading it off the real `status`
  // rather than hardcoding the `pending` branch is what keeps this row
  // honest if that read's own contract ever widens.
  const treatment = STATUS_TREATMENT[proposal.status];
  const summary = pendingProposalSummary(proposal, stageNames);
  const dueAtText = pendingProposalDueAtText(proposal, timezone);

  return (
    <li>
      <Link
        href={`/dashboard/accounts/${accountId}/calls/${proposal.callId}#call-proposals`}
        className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-[var(--surface-3)]"
      >
        <Badge variant="chip" className={cn("w-fit gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
          <span className={cn("size-[7px] rounded-full", treatment.dot)} aria-hidden />
          {m[treatment.labelKey]}
        </Badge>
        <span className="text-sm font-medium text-card-foreground">{summary}</span>
        {dueAtText ? (
          <span className="text-xs text-muted-foreground">
            {m["proposals.task.due"].replace("{date}", () => dueAtText)}
          </span>
        ) : null}
        {contactName ? <span className="text-xs text-muted-foreground">{contactName}</span> : null}
        <p className="text-sm leading-6 text-muted-foreground">
          {m["proposals.evidence"]}{" "}
          <q className="text-foreground">{proposal.evidence}</q>
        </p>
      </Link>
    </li>
  );
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

  const rowClassName = "flex items-center gap-3 px-4 py-3 text-sm";

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
    <li className={cn(LIST_ROW, "flex items-center transition-colors hover:bg-[var(--surface-3)]")}>
      {row.contactId ? (
        <Link
          href={`/dashboard/accounts/${accountId}/contacts/${row.contactId}`}
          className={cn(rowClassName, "min-w-0 flex-1")}
        >
          {body}
        </Link>
      ) : (
        <div className={cn(rowClassName, "min-w-0 flex-1")}>{body}</div>
      )}
      <div className="shrink-0 pr-4">
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
  proposals = [],
  stageNames = {},
}: {
  buckets: BucketedWork;
  accountId: string;
  /** contactId → display name, for every non-null contactId across every
   *  bucket AND every pending proposal — ONE batch read (page.tsx), never
   *  one per row and never one per account. A contactId absent from this map
   *  (a deleted, or otherwise missing, contact) falls back to
   *  `m["contact.noName"]` below — never a raw id, never "undefined". */
  contactNames: Record<string, string>;
  /** The account's RESOLVED zone (`renderZone`) — the SAME contract
   *  `calls-table.tsx`'s identically-named prop now carries. This screen
   *  used to differ on purpose (omit rather than guess); it no longer does,
   *  because the guess is no longer silent. One rule, five screens. */
  timezone: string;
  /** This account's own pending proposals (`listPendingProposals`) — a
   *  QUESTION about work, never work itself, so it is NEVER folded into
   *  `buckets`/`Bucket` (task-11-brief's own binding constraint, mirroring
   *  the agency screen's identical rule for `AgencyBucketedWork`). Optional
   *  (defaults to none) so every existing call site — and every existing
   *  test — is unaffected by this prop's addition. */
  proposals?: CallProposal[];
  /** page.tsx's own batched `pipeline_stages` read, keyed by stage id —
   *  see `pendingProposalSummary`'s own doc comment. Optional for the same
   *  reason `proposals` is. */
  stageNames?: Record<string, ResolvedStage>;
}) {
  const shown = visibleBuckets(buckets);

  // Fix-wave Important 3: the real queue can be empty while a suggestion
  // still exists — mirrors the agency screen's own
  // `shown.length === 0 && proposals.length === 0` gate exactly, so this
  // screen never claims "Nothing needs you right now" over a real,
  // pending proposal.
  if (shown.length === 0 && proposals.length === 0) {
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
        // `data-bucket` is a test-only marker (no visual effect), matching
        // the agency screen's own — it lets a render test isolate ONE
        // bucket's own HTML from the proposals section beside it, the same
        // no-contamination proof that screen's binding constraint exists for.
        <section key={bucket} data-bucket={bucket} className="flex flex-col gap-2">
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
      {proposals.length > 0 ? (
        // A sibling <section>, never a fourth bucket (task-11-brief's own
        // binding constraint) — visually separated by Task 7's own CARD
        // shell, the identical shape the agency screen's own Suggestions
        // section uses.
        <section data-proposals aria-labelledby="account-proposals" className={CARD}>
          <h2 id="account-proposals" className={CARD_HEAD}>{m["proposals.work.heading"]}</h2>
          <p className="px-5 pt-3 text-sm text-muted-foreground">{m["proposals.account.body"]}</p>
          <ul className="divide-y divide-[var(--row-line)]">
            {proposals.map((p) => (
              <PendingProposalRow
                key={p.id}
                proposal={p}
                accountId={accountId}
                contactName={p.contactId ? (contactNames[p.contactId] ?? m["contact.noName"]) : null}
                stageNames={stageNames}
                timezone={timezone}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
