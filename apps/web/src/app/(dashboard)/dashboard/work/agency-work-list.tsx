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
import type { AgencyWorkRow, CallProposal, ContactFieldPayload } from "@bis/db";
import type { Bucket } from "@/lib/work/buckets";
import type { AgencyBucketedWork } from "@/lib/work/agency-buckets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { formatDateInZone } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
// Task 7's own extracted, reusable pieces (its header comment says so) —
// reused here rather than copied: the SAME status-treatment map (every
// proposal `listPendingProposalsForAgency` returns is `pending` by
// construction, so only that one entry of the map is ever read) and the
// SAME card shell the call-detail page's own Suggested-next-steps block
// uses, so this screen's suggestions read as visually distinct from a
// plain bucket's `ListPanel` — the binding constraint's own "visually
// separated" requirement — without inventing a second card language.
import { STATUS_TREATMENT } from "../accounts/[accountId]/calls/[callId]/proposals";
import { CARD, CARD_HEAD } from "../accounts/[accountId]/calls/[callId]/card";

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
            to, never as the row's own status or title. A suppressed
            account's mark lives right here, next to the caption — this is
            "the interface where the company is identified" (danlo,
            2026-09-15): the account's own work is no longer hidden (a
            suppressed account used to be dropped from this read entirely),
            so the agency sees it and is told, dot plus word, not to text. */}
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {/* brandDisplayName (packages/db/src/branding.ts) has no fallback
                to accounts.name any more — a blank result reaches here as ""
                rather than the internal label, and this is where it degrades
                to a neutral placeholder instead of an empty caption. */}
            {row.brandName || m["work.agency.unbranded"]}
          </span>
          {row.suppressed ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-[var(--warn)]">
              <span className="size-[5px] shrink-0 rounded-full bg-[var(--warn)]" aria-hidden />
              {m["work.agency.suppressed"]}
            </span>
          ) : null}
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

// ── Work Queue Task 10 — pending suggestions ────────────────────────────
//
// A proposal is a QUESTION about work, not work — it is rendered as its own
// sibling `<section>`, never folded into `buckets` (task-10-brief.md's own
// binding constraint on `Bucket`/`BucketedWork`, `lib/work/buckets.ts`).
// `listPendingProposalsForAgency` (packages/db/src/call-proposals.ts) is
// this screen's cross-tenant twin of `listPendingProposals`, carrying the
// same `brandName` field every other row on this page already does.
export type AgencyProposal = CallProposal & { brandName: string };

/** Restated from proposals.tsx's own (unexported) `FIELD_LABEL_KEY` — same
 *  reasoning as `BUCKET_TREATMENT` above: a four-entry map, not worth
 *  reaching across a route boundary for. */
const PROPOSAL_FIELD_LABEL_KEY: Record<ContactFieldPayload["field"], MessageKey> = {
  firstName: "contacts.firstName", lastName: "contacts.lastName",
  email: "contacts.email", phone: "contacts.phone",
};

/**
 * The proposal's own plain-language sentence, or `null` for a kind this
 * screen cannot describe honestly.
 *
 * `task` and `contact_field` are fully self-contained in their own payload
 * — nothing else needs resolving. `opportunity_stage` is different: its
 * payload carries only `fromStageId`/`toStageId` uuids, and describing it
 * honestly means resolving those against the account's OWN
 * `pipeline_stages` (exactly what the call-detail page's own `buildLabel`
 * does, scoped to the one account already on that page). This screen is
 * cross-tenant by construction — doing the same resolution here means a
 * SECOND per-account table join across every account with a pending
 * proposal, to serve a kind this compact queue may show only rarely, and
 * nothing in this task's brief asks for it. Same honesty rule either way
 * (DESIGN.md: never the raw uuid, never the destination alone) — a
 * proposal this view cannot describe honestly renders nothing here rather
 * than something false. See this task's report for the finding.
 */
function proposalSummary(p: CallProposal): string | null {
  if (p.kind === "task") {
    return m["proposals.task.label"].replace("{title}", () => p.payload.title);
  }
  if (p.kind === "contact_field") {
    const fieldLabel = m[PROPOSAL_FIELD_LABEL_KEY[p.payload.field]].toLowerCase();
    return m["proposals.contactField.label"]
      .replace("{field}", () => fieldLabel)
      .replace("{value}", () => p.payload.value);
  }
  return null;
}

function AgencyProposalRow({
  proposal,
  contactName,
}: {
  proposal: AgencyProposal;
  /** `null` when the proposal carries no contact — never rendered, unlike
   *  a bucket row's own always-present fallback, because a suggestion about
   *  a contact detail or a task is still legible without one. */
  contactName: string | null;
}) {
  const summary = proposalSummary(proposal);
  // Never reached — AgencyWorkList filters these out before mapping — but
  // typed to return null anyway so this component alone can never render a
  // kind it cannot describe honestly.
  if (summary === null) return null;
  // Every row here is `pending` by construction (listPendingProposalsForAgency
  // only ever returns pending proposals) — the one entry of Task 7's
  // STATUS_TREATMENT this screen ever reads.
  const treatment = STATUS_TREATMENT.pending;

  return (
    <li>
      <Link
        href={`/dashboard/accounts/${proposal.accountId}/calls/${proposal.callId}#call-proposals`}
        className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-[var(--surface-3)]"
      >
        <span className="truncate font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {proposal.brandName || m["work.agency.unbranded"]}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="chip" className={cn("shrink-0 gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
            <span className={cn("size-[7px] rounded-full", treatment.dot)} aria-hidden />
            {m[treatment.labelKey]}
          </Badge>
          <span className="text-sm font-medium text-card-foreground">{summary}</span>
        </span>
        {contactName ? <span className="text-xs text-muted-foreground">{contactName}</span> : null}
        {/* Evidence has no transcript beside it here, unlike the call-detail
            page's own Suggested-next-steps block — the row's OWN link above
            is how a reader checks the quote against the whole call it came
            from, deep-linked to that page's own `#call-proposals` section
            rather than its top. */}
        <p className="text-sm leading-6 text-muted-foreground">
          {m["proposals.evidence"]}{" "}
          <q className="text-foreground">{proposal.evidence}</q>
        </p>
      </Link>
    </li>
  );
}

export function AgencyWorkList({
  buckets,
  contactNames,
  proposals = [],
}: {
  buckets: AgencyBucketedWork;
  /** contactId → display name, for every non-null contactId across every
   *  bucket and every account — ONE batch read (page.tsx), never one per
   *  row and never one per account. A contactId absent from this map falls
   *  back to m["contact.noName"] below — never a raw id, never
   *  "undefined". Also resolves a proposal row's own contact, from the
   *  SAME batch read (page.tsx extends the same id collection). */
  contactNames: Record<string, string>;
  /** Every account's pending proposals, pooled the same way `buckets` is.
   *  Optional (defaults to none) so every existing call site — and every
   *  existing test — is unaffected by this prop's addition. */
  proposals?: AgencyProposal[];
}) {
  const shown = visibleAgencyBuckets(buckets);
  // Filtered BEFORE anything below ever sees them — a kind this screen
  // cannot describe honestly (see `proposalSummary`) counts as nothing to
  // show, not as an empty-looking row.
  const visibleProposals = proposals.filter((p) => proposalSummary(p) !== null);

  if (shown.length === 0 && visibleProposals.length === 0) {
    return (
      <EmptyState
        icon={ListTodo}
        title={m["work.empty"]}
        body={m["work.agency.empty.body"]}
        // The sentence plus the action that causes it (DESIGN.md rule 5).
        // This screen's rows are derived and pooled across every account —
        // there is no single "create" action on THIS screen — so the action
        // is the jumping-off point into the account list, where the tasks,
        // replies and closed-out bookings that would show up here happen.
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/accounts">{m["work.agency.empty.action"]}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {shown.map((bucket) => (
        // `data-bucket` is a test-only marker (no visual effect): it lets a
        // render test isolate ONE bucket's own HTML from a sibling section's
        // — the no-contamination proof this screen's binding constraint
        // exists for (task-10-brief.md).
        <section key={bucket} data-bucket={bucket} className="flex flex-col gap-2">
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
      {visibleProposals.length > 0 ? (
        // A sibling `<section>`, never a fourth bucket — visually separated
        // by Task 7's own CARD shell (a bordered, glass panel; a bucket's
        // own ListPanel below shares that exact styling by coincidence of
        // BOTH constants being `overflow-hidden rounded-xl border
        // border-border bg-card glass`, but this one ALSO carries a labelled
        // heading + subhead, which no bucket section has, so "Suggestions"
        // never reads as a fourth Overdue/Today/Waiting).
        <section data-proposals aria-labelledby="agency-proposals" className={CARD}>
          <h2 id="agency-proposals" className={CARD_HEAD}>{m["proposals.work.heading"]}</h2>
          <p className="px-5 pt-3 text-sm text-muted-foreground">{m["proposals.work.body"]}</p>
          <ul className="divide-y divide-[var(--row-line)]">
            {visibleProposals.map((p) => (
              <AgencyProposalRow
                key={p.id}
                proposal={p}
                contactName={p.contactId ? (contactNames[p.contactId] ?? m["contact.noName"]) : null}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
