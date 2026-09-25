// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/activity-card.tsx
//
// Task 7: the events ledger's first READ consumer. A server component — data
// arrives entirely as props from the page, the same shape as calls-chart-card.tsx
// (Task 6): the page's own `Promise.all` calls `listRecentEvents`, this file
// only curates and renders what comes back.
//
// ─── THE CURATION MAP (grep-verified against every real `emit(` call site in
// the tree — packages/db/src/{accounts,activities,blueprints,booking,branding,
// contacts,forms,messaging,opportunities,sending-identity,voice}.ts and
// apps/web/src/lib/voice/finish-call.ts, 2026-09-01) ───
//
// Rendered (an honest, owner-readable line exists):
//   - "booking.created"                              → bookingCreated
//   - "booking.cancelled"                             → bookingCancelled
//   - "booking.status_changed", payload.status="cancelled" → bookingCancelled
//     (same real-world fact as booking.cancelled, just reached via the
//     operator/voice-reschedule path — setBookingStatus — instead of the
//     public cancel-link; the owner does not care which mechanism cancelled
//     it, so both TYPES fold into one line)
//   - "booking.status_changed", payload.status="completed"  → bookingCompleted
//   - "booking.status_changed", payload.status="no_show"    → bookingNoShow
//   - "form.submitted"                                → formSubmitted
//   - "call.recorded"                                 → callRecorded, with
//     payload.outcome resolved through the calls list's OWN `OUTCOMES` map
//     (calls/format.ts) — reused, not duplicated, the same principle Task 6
//     applied to `OutcomePill`. An outcome value `OUTCOMES` doesn't
//     recognize is treated as unknown (skipped), never rendered raw.
//
// Deliberately SKIPPED (event types that exist in the ledger today but do
// NOT get a feed line — a judgment call, recorded here rather than silently
// made):
//   - "account.*", "calendar.*", "blueprint.*", "phone_number.*",
//     "voice_profile.*", "form.created"/"form.updated" — agency/account
//     SETUP plumbing, not evidence of business activity a landscaper reads
//     this card for (same category as the mockup's own dropped rows).
//   - "contact.created"/"contact.updated", "note.created", "task.created"/
//     "task.completed" — CRM housekeeping. Payloads carry only ids (no note
//     body, no task title), so there is nothing substantive to say beyond a
//     generic "something was edited" — not worth a row.
//   - "opportunity.*", "conversation.created", "message.*" — real business
//     signals in principle, but out of this task's curated set: the brief's
//     three expected categories are booking / lead-form / call outcomes,
//     and unlike `call.recorded`'s outcome or `booking.status_changed`'s
//     status, these payloads don't carry a value that turns "something
//     changed" into an honest, specific sentence without a second read this
//     helper's signature doesn't do. Left for a future task, not invented.
//
// Any type/status/outcome not in the table above is skipped SILENTLY (no
// placeholder row, no raw type string ever reaches the DOM) — the brief's
// own DATA HONESTY rule.
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Activity, CalendarCheck, CalendarX, CheckCircle2, Mail, Phone } from "lucide-react";
import type { EventRow, CallOutcome } from "@bis/db";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { relativeTime } from "@/lib/dashboard/relative-time";
import { OUTCOMES } from "../calls/format";

/** How many curated rows the card shows. `events` arrives already fetched at
 *  a generously larger raw limit (the page's own `listRecentEvents` call) —
 *  most real accounts interleave curated types with skipped CRM plumbing, so
 *  slicing to the display count AFTER curation (not before) is what keeps a
 *  busy contacts/opportunities day from silently emptying this card despite
 *  real recent bookings sitting a few rows further back in the ledger. */
const DISPLAY_LIMIT = 8;

type Tone = "success" | "warning" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  accent: "bg-primary/10 text-primary",
};

type CuratedRow = {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  summary: string;
  createdAtIso: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The one place raw `events.type`/payload values get turned into copy —
 *  everything not covered by the curation map above returns `null`. */
function curate(event: EventRow): CuratedRow | null {
  const payload = isRecord(event.payload) ? event.payload : {};

  switch (event.type) {
    case "booking.created":
      return {
        key: event.id, icon: CalendarCheck, tone: "success",
        summary: m["dashboard.activity.bookingCreated"], createdAtIso: event.createdAt,
      };
    case "booking.cancelled":
      return {
        key: event.id, icon: CalendarX, tone: "warning",
        summary: m["dashboard.activity.bookingCancelled"], createdAtIso: event.createdAt,
      };
    case "booking.status_changed": {
      const status = typeof payload.status === "string" ? payload.status : null;
      if (status === "cancelled") {
        return {
          key: event.id, icon: CalendarX, tone: "warning",
          summary: m["dashboard.activity.bookingCancelled"], createdAtIso: event.createdAt,
        };
      }
      if (status === "completed") {
        return {
          key: event.id, icon: CheckCircle2, tone: "success",
          summary: m["dashboard.activity.bookingCompleted"], createdAtIso: event.createdAt,
        };
      }
      if (status === "no_show") {
        return {
          key: event.id, icon: CalendarX, tone: "warning",
          summary: m["dashboard.activity.bookingNoShow"], createdAtIso: event.createdAt,
        };
      }
      // An unrecognized status (none exist today — setBookingStatus's own
      // doc comment: "cancel, mark completed, mark no-show" — but a future
      // status must not render a fabricated line for it).
      return null;
    }
    case "form.submitted":
      return {
        key: event.id, icon: Mail, tone: "accent",
        summary: m["dashboard.activity.formSubmitted"], createdAtIso: event.createdAt,
      };
    case "call.recorded": {
      const outcome = typeof payload.outcome === "string" ? (payload.outcome as CallOutcome) : null;
      const treatment = outcome ? OUTCOMES[outcome] : undefined;
      if (!treatment) return null; // unrecognized outcome — never render it raw
      return {
        key: event.id, icon: Phone, tone: "accent",
        summary: m["dashboard.activity.callRecorded"].replace("{outcome}", treatment.label),
        createdAtIso: event.createdAt,
      };
    }
    default:
      return null;
  }
}

export function ActivityCard({
  accountId,
  events,
  now,
}: {
  accountId: string;
  /** Raw ledger rows, newest first — `listRecentEvents(db, accountId, N)`,
   *  N deliberately larger than `DISPLAY_LIMIT` (see that constant's own
   *  comment). */
  events: EventRow[];
  /** Caller-injected instant for `relativeTime` — the page's own `now`,
   *  never a fresh `Date.now()` read in here (booking.ts's `nowIso`
   *  discipline: a value computed once at the top of the request, not
   *  re-read per row). */
  now: Date;
}) {
  const rows = events
    .map(curate)
    .filter((row): row is CuratedRow => row !== null)
    .slice(0, DISPLAY_LIMIT);
  const isEmpty = rows.length === 0;
  const nowMs = now.getTime();
  const pipelineHref = `/dashboard/accounts/${accountId}/pipeline`;

  return (
    <div className="rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3">
      <div className="flex items-baseline gap-2">
        <h5 className="text-[13.5px] font-semibold text-card-foreground">{m["dashboard.activity.title"]}</h5>
        <span className="ml-auto font-mono text-[10px] font-normal tracking-[0.14em] text-muted-foreground uppercase">
          {m["dashboard.activity.caption"]}
        </span>
      </div>

      {/* Rule 5's empty state carries no action of its own (the brief's own
          words: "No action link needed") — the footer below is the card's
          ONE real affordance, and unlike calls-chart-card.tsx's empty state
          (whose ctaHref IS the EmptyState's action), it stays outside the
          conditional and renders in EVERY state, matching the mockup's own
          markup: the `.feed` div and the button row are two separate
          siblings, never one swapped for the other. */}
      {isEmpty ? (
        <EmptyState icon={Activity} title={m["dashboard.activity.empty"]} />
      ) : (
        // The rule is --row-line (.06), the mockup's `.row`; `divide-border`
        // was --line (.08), a third stronger than every other row rule here.
        <div className="mt-2 flex flex-col">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-start gap-2.5 border-t border-[var(--row-line)] py-2.5 first:border-t-0 first:pt-0 last:pb-0"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-[26px] shrink-0 items-center justify-center rounded-[var(--radius-ctl)]",
                  TONE_CLASSES[row.tone],
                )}
              >
                <row.icon className="size-3.5" />
              </span>
              <p className="flex-1 pt-0.5 text-[12.5px] leading-snug font-medium text-card-foreground">
                {row.summary}
              </p>
              <span className="shrink-0 pt-1 font-mono text-[9.5px] text-muted-foreground">
                {relativeTime(row.createdAtIso, nowMs)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3.5">
        <Link href={pipelineHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          {m["pipeline.add"]}
        </Link>
      </div>
    </div>
  );
}
