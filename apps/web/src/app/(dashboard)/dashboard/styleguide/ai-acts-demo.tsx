"use client";

import type { AiAct } from "@bis/db/ai-act-rules";
import { ActRow } from "@/components/ai-acts/act-row";
import { BookingUndoForm, ContactUndoForm, type ActUndoRun } from "@/components/ai-acts/act-undo";
import { buildActView } from "@/lib/ai-acts/view";
import { formatDateTimeInZone } from "@/lib/format";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { ActFacts } from "@/lib/ai-acts/kinds/types";

/**
 * Sofía's actions on the timeline (item 8c, plan Task 6; Task 9 design review I-8, M-9), in English, Spanish
 * and the pseudo-locale:
 *   - one row per control state — available field, booking with an email on file, booking with none,
 *     contact, blocked, undone, unknown — on the timeline's own row rules, built from the real
 *     `buildActView`, so this page cannot drift from the row. A blocked or undone row's line sits under its
 *     source (design I-3), which is what keeps this page inside 375 px;
 *   - the booking popover's body drawn inline, ticked and with no email on file, and the contact dialog's
 *     body twice, empty (Remove disabled) and with the name typed (Remove enabled).
 * Every mark label and time is the specimen's own language (no typed "Sofía · AI" or "9:42 AM").
 * INERT: no specimen reaches a server action (design M-9). The rows' Undo controls get `INERT` (a refusal,
 * whose toast is the only thing a click does) and the forms get no-ops. No props, no server data: it builds
 * its columns here, in the client (the `WorkTrayDemo` shape, final review I-1 of 8b-2).
 */

const ZONE = "America/Chicago";
const PERSONA = "Sofía";
const LOCALES = [
  { key: "en", tr: makeTr("en") }, { key: "es", tr: makeTr("es") }, { key: "pseudo", tr: makeTr("en", true) },
] as const;

/** What a click on a specimen's Undo calls: never a server action. */
export const INERT: ActUndoRun = {
  undo: async () => ({ ok: false, reason: "notAvailable" }),
  redo: async () => ({ ok: false, reason: "notAvailable" }),
};
const noop = () => {};

const base = {
  accountId: "acct_demo", contactId: "ct_demo", actor: "voice" as const, callId: "call_demo", chatId: null,
  createdAt: "2026-10-15T14:42:00.000Z", undoneAt: null as string | null, undoneBy: null as string | null, undoNotified: false,
};
const SLOT_EMAIL = { startsAt: "2026-10-22T15:00:00.000Z", endsAt: "2026-10-22T16:00:00.000Z" };
const SLOT_NO_EMAIL = { startsAt: "2026-10-23T18:00:00.000Z", endsAt: "2026-10-23T19:00:00.000Z" };
const SLOT_BLOCKED = { startsAt: "2026-10-18T15:00:00.000Z", endsAt: "2026-10-18T16:00:00.000Z" };
const SLOT_UNKNOWN = { startsAt: "2026-10-24T15:00:00.000Z", endsAt: "2026-10-24T16:00:00.000Z" };
/** Each act's id carries its column's key: a row's id names its sentence (`aria-describedby`), and three
 *  columns on one page must not share one. */
function acts(col: string): Record<string, AiAct> {
  const b = { ...base };
  return {
    field: { ...b, id: `act_field_${col}`, kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value: "ana@example.com" } },
    bookingEmail: { ...b, id: `act_booking_email_${col}`, kind: "booking_created", target: { bookingId: "bk1" }, before: null, after: SLOT_EMAIL },
    bookingNoEmail: { ...b, id: `act_booking_no_email_${col}`, kind: "booking_created", target: { bookingId: "bk2" }, before: null, after: SLOT_NO_EMAIL },
    contact: { ...b, id: `act_contact_${col}`, kind: "contact_created", target: {}, before: null, after: null },
    blocked: { ...b, id: `act_blocked_${col}`, kind: "booking_created", target: { bookingId: "bk3" }, before: null, after: SLOT_BLOCKED },
    undone: { ...b, id: `act_undone_${col}`, kind: "contact_field_filled", target: { field: "phone" }, before: { value: null }, after: { value: "+15125550100" }, undoneAt: "2026-10-19T09:00:00.000Z", undoneBy: "user_dan" },
    unknown: { ...b, id: `act_unknown_${col}`, kind: "booking_created", target: { bookingId: "bk4" }, before: null, after: SLOT_UNKNOWN },
  };
}
function factsFor(col: string): { email: ActFacts; noEmail: ActFacts } {
  const email: ActFacts = {
    now: new Date("2026-10-20T12:00:00.000Z"),
    bookings: {
      bk1: { status: "booked", ...SLOT_EMAIL, updatedAt: base.createdAt, replacedBy: null, slotTaken: false },
      bk3: { status: "cancelled", ...SLOT_BLOCKED, updatedAt: base.createdAt, replacedBy: null, slotTaken: false },
    },
    contact: { first_name: "Ana", last_name: "Ruiz", email: "ana@example.com" },
    heldBy: { [`act_contact_${col}`]: [] }, editors: {}, canDelete: true, futureBooked: [],
  };
  return {
    email,
    noEmail: {
      ...email,
      bookings: { bk2: { status: "booked", ...SLOT_NO_EMAIL, updatedAt: base.createdAt, replacedBy: null, slotTaken: false } },
      contact: { first_name: "Ana", last_name: "Ruiz", email: null },
    },
  };
}

const RULE = "border-t border-[var(--row-line)] first:border-t-0";
const CAPTION = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

function specimen(key: string, tr: Tr, act: AiAct, facts: ActFacts | null) {
  const view = buildActView(act, facts, { tr, zone: ZONE, personaName: PERSONA, names: { user_dan: "Dan López" }, viewerId: "user_me", accountId: base.accountId });
  const head = {
    kind: "aiAct", status: null, verb: view.verb, detail: view.detail, dateTime: act.createdAt,
    mark: { kind: "ai" as const, label: tr.text("provenance.ai", { name: PERSONA }) },
    time: formatDateTimeInZone(act.createdAt, ZONE, tr.locale),
  };
  return (
    <div key={key} data-sg-ai-act={key} className={RULE}>
      <ActRow head={head} act={view} accountId={base.accountId} locale={tr.locale} run={INERT} />
    </div>
  );
}

export function AiActsDemo() {
  return (
    <div className="flex w-full flex-col gap-6">
      {LOCALES.map(({ key, tr }) => {
        const a = acts(key);
        const f = factsFor(key);
        const booking = buildActView(a.bookingEmail!, f.email, { tr, zone: ZONE, personaName: PERSONA, names: {}, viewerId: null, accountId: base.accountId });
        return (
          <div key={key} data-sg-ai-acts={key} lang={tr.locale}
            className="flex min-w-0 max-w-[480px] flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--line)] p-3">
            <p className={CAPTION}>{key}</p>
            <div className="flex min-w-0 flex-col">
              {specimen("field", tr, a.field!, f.email)}
              {specimen("booking-email", tr, a.bookingEmail!, f.email)}
              {specimen("booking-no-email", tr, a.bookingNoEmail!, f.noEmail)}
              {specimen("contact", tr, a.contact!, f.email)}
              {specimen("blocked", tr, a.blocked!, f.email)}
              {specimen("undone", tr, a.undone!, f.email)}
              {specimen("unknown", tr, a.unknown!, null)}
            </div>
            <div data-sg-ai-act-form="booking-ticked" className="rounded-[var(--radius-card)] border border-[var(--line)] p-3">
              <BookingUndoForm tr={tr} verb={booking.verb} detail={booking.detail} notify={{ name: "Ana Ruiz" }} ticked busy={false}
                onTicked={noop} onCancel={noop} onConfirm={noop} />
            </div>
            <div data-sg-ai-act-form="booking-no-email" className="rounded-[var(--radius-card)] border border-[var(--line)] p-3">
              <BookingUndoForm tr={tr} verb={booking.verb} detail={booking.detail}
                notify={{ none: tr.text("aiActs.notify.noEmail", { name: "Ana Ruiz" }) }} ticked busy={false}
                onTicked={noop} onCancel={noop} onConfirm={noop} />
            </div>
            <div data-sg-ai-act-form="contact-empty" className="rounded-[var(--radius-card)] border border-[var(--line)] p-3">
              <ContactUndoForm tr={tr} persona={PERSONA} contactName="Ana Ruiz" typed="" busy={false} fromChat={false}
                onTyped={noop} onCancel={noop} onConfirm={noop} />
            </div>
            <div data-sg-ai-act-form="contact-matched" className="rounded-[var(--radius-card)] border border-[var(--line)] p-3">
              <ContactUndoForm tr={tr} persona={PERSONA} contactName="Ana Ruiz" typed="Ana Ruiz" busy={false} fromChat={false}
                onTyped={noop} onCancel={noop} onConfirm={noop} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
