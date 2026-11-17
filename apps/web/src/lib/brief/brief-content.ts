// apps/web/src/lib/brief/brief-content.ts
// ALL of the daily brief's shaping, in one module (plan D5, risk "F-100 may later change what the brief says"). Pure:
// it takes the owner line's own three reads (so the email and the phone call can never disagree about "your day")
// plus the Monday report's lead count, and returns structured facts. It makes no sentence and no markup:
// brief-copy.ts words them, templates/daily-brief.ts lays them out, and a text-message renderer would be a sibling
// of that template (the seam the plan leaves). A section with nothing in it is null: omitted, never zeroed.
import { makeTr } from "@/lib/record/copy";
import { statusWord } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/agenda-view";
import type { AppointmentsResult, CallsAndMessagesResult, NeedsAttentionResult } from "@/lib/owner-line/tools/read";
import type { Locale } from "@/lib/i18n/locale";

/** How many To-dos the email names; the rest are a count ("and N more", never a silent cap). */
export const BRIEF_TODOS_LISTED = 5;

export type BriefContent = {
  locale: Locale;
  /** The business's customer-facing name (brandDisplayName), never accounts.name. */
  brandName: string;
  /** "Tuesday, June 15", in the account's zone and the person's language. */
  dayLabel: string;
  bookings: {
    count: number;
    items: { time: string; customer: string | null; meetingType: string | null }[];
    /** Jobs the read did not list (its own cap). */
    more: number;
  } | null;
  calls: { count: number } | null;
  leads: { count: number } | null;
  todos: { count: number; items: { what: string; due: string | null }[]; more: number } | null;
};

export type BriefReads = {
  locale: Locale;
  brandName: string;
  zone: string;
  now: Date;
  /** `appointments(ctx, { range: "today" })`. */
  appointments: AppointmentsResult;
  /** `callsAndMessages(ctx, { range: "yesterday" })`. */
  calls: CallsAndMessagesResult;
  /** `listLeadInstantsBetween(...).length` over yesterday, the Monday report's own lead read. */
  leads: number;
  /** `needsAttention(ctx)`. */
  todos: NeedsAttentionResult;
};

function dayLabel(now: Date, zone: string, locale: Locale): string {
  // Throws RangeError for a zone it cannot read: a brief for the wrong day is worse than none, and the pass
  // counts the throw as one failed subscription.
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    timeZone: zone, weekday: "long", month: "long", day: "numeric",
  }).format(now);
}

const section = <T>(count: number, make: () => T): T | null => (count > 0 ? make() : null);

export function shapeBrief(r: BriefReads): BriefContent {
  // A failed read is a failure the pass counts, never a zero: "a metric not measured is omitted, never zeroed".
  if (!r.appointments.ok) throw new Error(`brief: the appointments read failed (${r.appointments.error})`);
  if (!r.calls.ok) throw new Error(`brief: the calls read failed (${r.calls.error})`);
  const label = dayLabel(r.now, r.zone, r.locale);

  // Only jobs still `booked`. The agenda read returns every status except a replaced cancellation, and gives the
  // status as the reader's WORD (statusWord), so "booked" is matched by that same word from the same function.
  // The four words are distinct in both languages (pinned in the test). Jobs beyond the read's own cap are
  // `more`, an upper bound (it cannot say which of them are cancelled); no real shop books 25 jobs in a day.
  const bookedWord = statusWord(makeTr(r.locale), "booked");
  const booked = r.appointments.appointments.filter((a) => a.status === bookedWord);
  const more = r.appointments.more;

  return {
    locale: r.locale, brandName: r.brandName, dayLabel: label,
    bookings: section(booked.length + more, () => ({
      count: booked.length + more,
      items: booked.map((a) => ({ time: a.when, customer: a.customer, meetingType: a.meetingType })),
      more,
    })),
    calls: section(r.calls.count, () => ({ count: r.calls.ok ? r.calls.count : 0 })),
    leads: section(r.leads, () => ({ count: r.leads })),
    todos: section(r.todos.count, () => ({
      count: r.todos.count,
      items: r.todos.items.slice(0, BRIEF_TODOS_LISTED).map((i) => ({ what: i.what, due: i.due })),
      more: Math.max(0, r.todos.count - BRIEF_TODOS_LISTED),
    })),
  };
}
