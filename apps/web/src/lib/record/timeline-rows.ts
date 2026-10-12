import type { TimelineEntry, TimelineSource } from "@bis/db";
import type { TimelineTone } from "@/components/record/timeline-item";
import { formatCurrency, formatDateInZone, formatDateTimeInZone } from "@/lib/format";
import type { MessageKey } from "@/lib/messages";
import { authorMark, type AuthorCtx, type AuthorMarkView } from "./author-mark";
import type { Tr } from "./copy";

export type TimelineStatus = { tone: TimelineTone; word: string };
/** One row as the timeline draws it (spec §9.4): the grammar's parts, already in the page's language. */
export type TimelineRow = {
  key: string; entry: TimelineEntry; day: string; showDay: boolean; time: string;
  mark: AuthorMarkView; verb: string; status: TimelineStatus | null; detail: string | null;
};

type StatusMap = Readonly<Record<string, readonly [MessageKey, TimelineTone]>>;
const MESSAGE_STATUS: StatusMap = {
  queued: ["conversations.status.queued", "muted"], sent: ["conversations.status.sent", "accent"],
  delivered: ["conversations.status.delivered", "good"], opened: ["conversations.status.opened", "good"],
  bounced: ["conversations.status.bounced", "crit"], failed: ["conversations.status.failed", "crit"],
};
const BOOKING_STATUS: StatusMap = {
  booked: ["calendar.bookings.status.booked", "accent"], completed: ["calendar.bookings.status.completed", "good"],
  cancelled: ["calendar.bookings.status.cancelled", "muted"], no_show: ["calendar.bookings.status.no_show", "warn"],
};
const CALL_OUTCOME: StatusMap = {
  booked: ["calls.outcome.booked", "good"], lead: ["calls.outcome.lead", "accent"], message: ["calls.outcome.message", "accent"],
  abandoned: ["calls.outcome.abandoned", "muted"], spam: ["calls.outcome.spam", "muted"], transferred: ["calls.outcome.transferred", "accent"],
};
const DEAL_STATUS: StatusMap = {
  open: ["pipeline.status.open", "accent"], won: ["pipeline.status.won", "good"], lost: ["pipeline.status.lost", "muted"],
};
const SOURCE_KEY: Record<TimelineSource, MessageKey> = {
  notes: "timeline.what.notes", todos: "timeline.what.todos", deals: "timeline.what.deals", forms: "timeline.what.forms",
  messages: "timeline.what.messages", bookings: "timeline.what.bookings", calls: "timeline.what.calls",
};

/** A known value is a dot and a word (rule 3); an unmapped future one still shows, as itself (D-014). */
/** A deal's amount, or null when it has none: 0 and null are not an amount anyone entered
 *  (DESIGN.md: omitted, never zeroed), and "$0" would read as a free job. */
function amountText(value: number | string | null | undefined, tr: Tr): string | null {
  const n = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) && n !== 0 ? formatCurrency(n, tr.locale) : null;
}

function statusOf(map: StatusMap, value: string, tr: Tr): TimelineStatus {
  const hit = Object.hasOwn(map, value) ? map[value] : undefined;
  return hit ? { tone: hit[1], word: tr.text(hit[0]) } : { tone: "muted", word: value };
}

/** "Thu, Oct 16, 10:00 AM" in the account's zone and the page's language. */
function whenText(iso: string, zone: string, tr: Tr): string {
  return new Intl.DateTimeFormat(tr.locale === "es" ? "es-US" : "en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

function phrase(entry: TimelineEntry, mark: AuthorMarkView, zone: string, tr: Tr): Pick<TimelineRow, "verb" | "status" | "detail"> {
  switch (entry.kind) {
    case "note": return { verb: tr.text("timeline.note"), status: null, detail: null };
    case "task": return { verb: tr.text(entry.task.call_id ? "timeline.callbackTodo" : "timeline.todo"), status: null, detail: null };
    case "deal": return {
      verb: tr.text("timeline.deal", { name: entry.deal.name }),
      status: statusOf(DEAL_STATUS, entry.deal.status, tr),
      detail: amountText(entry.deal.monetary_value, tr),
    };
    case "submission": return {
      verb: mark.kind === "ai" ? tr.text("timeline.chat") : tr.text("timeline.form", { form: entry.submission.formName }),
      status: null, detail: null,
    };
    case "message": return {
      verb: tr.text(entry.message.channel === "sms" ? "timeline.texted" : "timeline.emailed"),
      // Only an outbound message has a delivery state worth a word: "sent" is what the provider took.
      status: entry.message.direction === "outbound" ? statusOf(MESSAGE_STATUS, entry.message.status, tr) : null,
      detail: null,
    };
    case "booking": return {
      verb: tr.text("timeline.booked", { when: whenText(entry.booking.starts_at, zone, tr) }),
      status: statusOf(BOOKING_STATUS, entry.booking.status, tr),
      detail: entry.booking.moved_from_starts_at
        ? tr.text("timeline.movedFrom", { when: whenText(entry.booking.moved_from_starts_at, zone, tr) }) : null,
    };
    case "call": return {
      verb: tr.text("timeline.answeredCall"),
      status: statusOf(CALL_OUTCOME, entry.call.outcome, tr),
      detail: entry.call.duration_secs ? tr.text("timeline.minutes", { count: Math.max(1, Math.round(entry.call.duration_secs / 60)) }) : null,
    };
  }
}

/**
 * The page's rows (spec §9.4), newest first as the merge returned them, each under a day separator
 * in the ACCOUNT's zone (D-010). Pure; THROWS on a malformed instant, so the page builds it inside
 * its view guard (C5): a bad row costs the timeline card, never the page.
 */
export function timelineRows(entries: readonly TimelineEntry[], ctx: { zone: string; tr: Tr; author: AuthorCtx }): TimelineRow[] {
  let previousDay: string | null = null;
  return entries.map((entry) => {
    const day = formatDateInZone(entry.at, ctx.zone, ctx.tr.locale);
    const mark = authorMark(entry, ctx.author);
    const row: TimelineRow = {
      key: `${entry.kind}-${entry.id}`, entry, day, showDay: day !== previousDay,
      time: formatDateTimeInZone(entry.at, ctx.zone, ctx.tr.locale), mark, ...phrase(entry, mark, ctx.zone, ctx.tr),
    };
    previousDay = day;
    return row;
  });
}

/** "Couldn't load calls and bookings." for the sources that failed; null when none did. */
export function timelineFailedText(failed: readonly TimelineSource[], tr: Tr): string | null {
  if (failed.length === 0) return null;
  const what = new Intl.ListFormat(tr.locale === "es" ? "es-US" : "en-US", { type: "conjunction" })
    .format(failed.map((s) => tr.text(SOURCE_KEY[s])));
  return tr.text("timeline.someFailed", { what });
}
