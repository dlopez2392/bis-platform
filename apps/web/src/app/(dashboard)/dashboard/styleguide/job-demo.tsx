"use client";

import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { JobForm, type JobFormSpecimen } from "../accounts/[accountId]/calendar/job-sheet";
import { JobDrawerDetails, JobDrawerHeader, type JobDrawerView } from "../accounts/[accountId]/calendar/job-drawer";

/**
 * F-046 part 1 (plan Task 11, step 4): the Add job sheet and the job drawer, for the styleguide (DESIGN.md's DoD: a
 * new component is on /styleguide). The sheet with its confirm-in-place warnings, and with the phone owner's
 * offer; the drawer for a booked staff job whose confirmation is about to go, and for a cancelled customer
 * booking. Each in English and Spanish. Sheet-styled frames, not open Sheets: an open Radix sheet would cover
 * this page, and its portal draws nothing in a server render.
 *
 * INERT: every handler is a no-op and nothing here names a server action. The specimen values (a customer, a
 * phone, a job, an address, two formatted times) are the named constants below, never JSX literals, so the i18n
 * ratchet counts nothing here; every other word is the catalogue's.
 */
const ZONE = "America/Chicago";
const ACCOUNT = "acct_demo";
const NAME = "Ana García";
const TYPED = "Ana Reyes";
const PHONE = "(956) 555-0100";
const WHAT = "Fix a leaking water heater";
const ADDRESS = "1200 N 10th St, McAllen";
const WHEN = { en: "Tue, Nov 3, 7:00 PM CST", es: "mar, 3 nov, 7:00 p.m. CST" } as const;
const MADE_AT = { en: "Nov 1, 9:42 AM", es: "1 nov, 9:42 a.m." } as const;
/** Every specimen value the demo shows. job-demo.test.ts allows these and the catalogue, nothing else. */
export const JOB_DEMO_SPECIMENS: readonly string[] = [NAME, PHONE, WHAT, ADDRESS, ...Object.values(WHEN), ...Object.values(MADE_AT)];

const LOCALES = ["en", "es"] as const;
const FRAME = "w-full max-w-md min-w-0 space-y-4 rounded-xl border border-[var(--line-strong)] glass-overlay p-4";
const TITLE = "text-base font-semibold text-foreground";
const noop = () => {};

const WARNINGS: JobFormSpecimen = { warnings: [
  { key: "outside_hours", kind: "outside_hours" },
  { key: "overlaps:sg-1", kind: "overlaps", count: 1, at: "2026-11-04T00:30:00.000Z" },
  { key: "closed", kind: "closed" },
] };
const OWNER: JobFormSpecimen = { phoneOwner: { id: "sg-ana", name: NAME, first: "Ana" }, typed: { name: TYPED, phone: PHONE } };

function view(kind: "booked" | "cancelled", locale: "en" | "es"): JobDrawerView {
  const booked = kind === "booked";
  return {
    id: `sg-${kind}-${locale}`,
    customer: { id: "sg-ana", name: NAME, first: "Ana", phone: PHONE, email: null },
    when: WHEN[locale], lengthMinutes: 90, what: booked ? WHAT : null, address: booked ? ADDRESS : null,
    meetingType: booked ? "in_person" : "video", meetingUrl: null,
    status: booked ? "booked" : "cancelled",
    statusWord: t(m, booked ? "calendar.bookings.status.booked" : "calendar.bookings.status.cancelled", locale),
    madeBy: t(m, booked ? "calendar.agenda.addedByYou" : "calendar.agenda.bookedOnline", locale),
    madeAt: MADE_AT[locale], confirmReply: booked ? null : "yes",
    email: booked ? { state: "pending", kind: "confirmation", at: null } : { state: "none", kind: null, at: null },
    holdOpen: booked, isMove: false, started: false, canWrite: true, canCloseOut: true,
    opened: { startsAt: "2026-11-04T01:00:00.000Z", endsAt: "2026-11-04T02:30:00.000Z", note: booked ? WHAT : null, placeId: null, meetingType: null, meetingUrl: null },
    told: !booked, recordHref: "#",
  };
}

export function JobDemo() {
  return (
    <div className="flex w-full min-w-0 flex-wrap gap-6">
      {LOCALES.flatMap((locale) => [
        <div key={`warnings-${locale}`} data-sg-job-sheet={`warnings-${locale}`} lang={locale} className={FRAME}>
          <h2 className={TITLE}>{t(m, "calendar.job.titleAdd", locale)}</h2>
          <JobForm accountId={ACCOUNT} timezone={ZONE} locale={locale} mode="add" specimen={WARNINGS}
            prefill={{ date: "2026-11-03", start: "19:00", minutes: 90, customer: { id: "sg-ana", name: NAME, first: "Ana" }, what: WHAT, meetingType: "in_person" }}
            calendarMeetingType="in_person" defaultMinutes={60} onDone={noop} onCancel={noop} />
          <span data-sg-job-end hidden />
        </div>,
        <div key={`owner-${locale}`} data-sg-job-sheet={`owner-${locale}`} lang={locale} className={FRAME}>
          <h2 className={TITLE}>{t(m, "calendar.job.titleAdd", locale)}</h2>
          <JobForm accountId={ACCOUNT} timezone={ZONE} locale={locale} mode="add" specimen={OWNER}
            prefill={{ date: "2026-11-03", start: "10:00", minutes: 60, meetingType: "in_person" }}
            calendarMeetingType="in_person" defaultMinutes={60} onDone={noop} onCancel={noop} />
          <span data-sg-job-end hidden />
        </div>,
      ])}
      {LOCALES.flatMap((locale) => (["booked", "cancelled"] as const).map((kind) => (
        <div key={`${kind}-${locale}`} data-sg-job-drawer={`${kind}-${locale}`} lang={locale} className={FRAME}>
          <JobDrawerHeader view={view(kind, locale)} locale={locale} />
          <JobDrawerDetails view={view(kind, locale)} timezone={ZONE} locale={locale}
            onMove={noop} onCancel={noop} onCloseOut={noop} />
          <span data-sg-job-end hidden />
        </div>
      )))}
    </div>
  );
}
