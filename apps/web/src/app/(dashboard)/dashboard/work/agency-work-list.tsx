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
//   - No action buttons on the WORK rows. The per-account "To do" screen's
//     Not now / Done / booking buttons are bound to ONE accountId
//     (tasks/actions.ts); wiring the same actions per-row across many accounts
//     is a bigger surface than this task's own brief asks for ("render grouped
//     with the brand name on every row" — nothing about acting from here). A
//     work row here is read-only; acting on it means following its own link
//     into that account. The SUGGESTIONS below are the exception (item 8b-2,
//     spec 5.2): the tray's own cards with their actions, grouped under each
//     account, each account's four actions bound to that account here.
import Link from "next/link";
import { ListTodo } from "lucide-react";
import type { AgencyWorkRow } from "@bis/db";
import type { Bucket } from "@/lib/work/buckets";
import type { AgencyBucketedWork } from "@/lib/work/agency-buckets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { formatDateInZone } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { workRowHref } from "@/lib/documents/card-focus";
import type { Tr } from "@/lib/record/copy";
import type { SuggestionGroup } from "@/lib/proposals/group";
import {
  acceptSuggestionAction, editAcceptSuggestionAction, discardSuggestionAction, undoSuggestionAction,
} from "@/lib/proposals/actions";
import { AgencySuggestionSection, type AgencySuggestionData } from "@/components/proposals/suggestion-section";
import { AiAuthorMark } from "../accounts/[accountId]/calls/ai-author-mark";

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
  // DESIGN.md, Provenance: a callback To do a call left (`callId`, 0064) is
  // the receptionist's, marked as on the account's own To do page.
  const fromCall = row.source === "task" && Boolean(row.callId);
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
        {secondary || fromCall ? (
          <span className="flex min-w-0 items-center gap-2">
            {secondary ? <span className="truncate text-xs text-muted-foreground">{secondary}</span> : null}
            {fromCall ? <AiAuthorMark /> : null}
          </span>
        ) : null}
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
  // S-07 3a: an expiry To-do links to its file (workRowHref), on THAT row's own account.
  const href = workRowHref(row.accountId, row);

  // Only a row tied to a real contact has anywhere to go, and it goes into
  // THAT row's own account (`row.accountId`) — never a single accountId
  // shared by the whole list, unlike the per-account screen's WorkRowItem.
  return (
    <li className={cn(LIST_ROW, "flex items-center transition-colors hover:bg-[var(--surface-3)]")}>
      {href ? (
        <Link href={href} className={rowClassName}>
          {body}
        </Link>
      ) : (
        <div className={rowClassName}>{body}</div>
      )}
    </li>
  );
}

// ── Pending suggestions (Work Queue Task 10; cards since item 8b-2) ──────
//
// A suggestion is a QUESTION about work, not work: it is rendered as its own
// sibling `<section>`, never folded into `buckets` (task-10-brief.md's own
// binding constraint on `Bucket`/`BucketedWork`, `lib/work/buckets.ts`).
// page.tsx reads every account's pending rows (`listPendingProposalsForAgency`,
// at most 50 per account, item 8b-2), builds each card in THAT account's zone
// and groups them by account, then as the tray (customer, then call).

const NO_SUGGESTIONS: AgencySuggestionsLoad = { ok: true, accounts: [] };

/** One account's suggestions as page.tsx built them; this file binds that account's actions. */
export type AgencySuggestionAccountView = {
  accountId: string; brandName: string; personaName: string; capped: boolean; groups: SuggestionGroup[];
};
/** The section's state: the accounts with something pending (none: no section), or the read failed. */
export type AgencySuggestionsLoad = { ok: true; accounts: AgencySuggestionAccountView[] } | { ok: false };

/** Each account's four actions bound to THAT account (plan fix I-3: `.bind`, never a closure, which a
 *  server component cannot hand a client one), and a blank brand name read as the neutral caption. */
function withActions(load: AgencySuggestionsLoad): AgencySuggestionData {
  if (!load.ok) return { ok: false };
  return {
    ok: true,
    accounts: load.accounts.map((a) => ({
      ...a,
      brandName: a.brandName || m["work.agency.unbranded"],
      actions: {
        accept: acceptSuggestionAction.bind(null, a.accountId),
        editAccept: editAcceptSuggestionAction.bind(null, a.accountId),
        discard: discardSuggestionAction.bind(null, a.accountId),
        undo: undoSuggestionAction.bind(null, a.accountId),
      },
    })),
  };
}

export function AgencyWorkList({
  buckets,
  contactNames,
  suggestions = NO_SUGGESTIONS,
  tr,
}: {
  buckets: AgencyBucketedWork;
  /** contactId → display name, for every non-null contactId across every
   *  bucket and every account — ONE batch read (page.tsx), never one per
   *  row and never one per account. A contactId absent from this map falls
   *  back to m["contact.noName"] below — never a raw id, never
   *  "undefined". Also resolves a proposal row's own contact, from the
   *  SAME batch read (page.tsx extends the same id collection). */
  contactNames: Record<string, string>;
  /** Every account's pending suggestions as cards, grouped by account (item 8b-2). Optional (defaults
   *  to none) so the bucket-only call sites and tests are unaffected. */
  suggestions?: AgencySuggestionsLoad;
  /** The suggestions' words in the operator's language (requestLocale). REQUIRED, never defaulted, as
   *  the tray's WorkList's is: a silent English default would show a Spanish reader English. */
  tr: Tr;
}) {
  const shown = visibleAgencyBuckets(buckets);
  // The real queue can be empty while a suggestion is pending, or while the
  // suggestions could not be read: never "Nothing needs you right now" over either.
  if (shown.length === 0 && suggestions.ok && suggestions.accounts.length === 0) {
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
      {/* A sibling section, never a fourth bucket: the tray's cards under each account's name. */}
      <AgencySuggestionSection tr={tr} data={withActions(suggestions)} />
    </div>
  );
}
