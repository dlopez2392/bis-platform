"use client";

import type { AiAct } from "@bis/db/ai-act-rules";
import { ActRow } from "@/components/ai-acts/act-row";
import { buildActView } from "@/lib/ai-acts/view";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { ActFacts } from "@/lib/ai-acts/kinds/types";

/**
 * Sofía's actions on the timeline (item 8c, plan Task 6): one specimen per control state — available
 * field, booking with an email on file, booking with none, contact, blocked, undone, unknown — in
 * English, Spanish and the pseudo-locale. Built from the real `buildActView`, so this page cannot drift
 * from the row. No props, no server data: it takes NO props and builds its columns here, in the client
 * (the `WorkTrayDemo` shape, final review I-1 of 8b-2): a server component cannot call a function this
 * file exports, and the stand-in facts hold no functions a server could not hand down anyway.
 */

const LOCALES = [
  { key: "en", tr: makeTr("en") }, { key: "es", tr: makeTr("es") }, { key: "pseudo", tr: makeTr("en", true) },
] as const;

const base = {
  accountId: "acct_demo", contactId: "ct_demo", actor: "voice" as const, callId: "call_demo", chatId: null,
  createdAt: "2026-10-15T14:42:00.000Z", undoneAt: null as string | null, undoneBy: null as string | null, undoNotified: false,
};
const SLOT_EMAIL = { startsAt: "2026-10-22T15:00:00.000Z", endsAt: "2026-10-22T16:00:00.000Z" };
const SLOT_NO_EMAIL = { startsAt: "2026-10-23T18:00:00.000Z", endsAt: "2026-10-23T19:00:00.000Z" };
const SLOT_BLOCKED = { startsAt: "2026-10-18T15:00:00.000Z", endsAt: "2026-10-18T16:00:00.000Z" };
const SLOT_UNKNOWN = { startsAt: "2026-10-24T15:00:00.000Z", endsAt: "2026-10-24T16:00:00.000Z" };
const ACTS: Record<string, AiAct> = {
  field: { ...base, id: "act_field", kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value: "ana@example.com" } },
  bookingEmail: { ...base, id: "act_booking_email", kind: "booking_created", target: { bookingId: "bk1" }, before: null, after: SLOT_EMAIL },
  bookingNoEmail: { ...base, id: "act_booking_no_email", kind: "booking_created", target: { bookingId: "bk2" }, before: null, after: SLOT_NO_EMAIL },
  contact: { ...base, id: "act_contact", kind: "contact_created", target: {}, before: null, after: null },
  blocked: { ...base, id: "act_blocked", kind: "booking_created", target: { bookingId: "bk3" }, before: null, after: SLOT_BLOCKED },
  undone: { ...base, id: "act_undone", kind: "contact_field_filled", target: { field: "phone" }, before: { value: null }, after: { value: "+15125550100" }, undoneAt: "2026-10-19T09:00:00.000Z", undoneBy: "user_dan" },
  unknown: { ...base, id: "act_unknown", kind: "booking_created", target: { bookingId: "bk4" }, before: null, after: SLOT_UNKNOWN },
};
const FACTS_EMAIL: ActFacts = {
  now: new Date("2026-10-20T12:00:00.000Z"),
  bookings: {
    bk1: { status: "booked", ...SLOT_EMAIL, updatedAt: base.createdAt, replacedBy: null, slotTaken: false },
    bk3: { status: "cancelled", ...SLOT_BLOCKED, updatedAt: base.createdAt, replacedBy: null, slotTaken: false },
  },
  contact: { first_name: "Ana", last_name: "Ruiz", email: "ana@example.com" },
  heldBy: { act_contact: [] }, editors: {}, canDelete: true, futureBooked: [],
};
const FACTS_NO_EMAIL: ActFacts = {
  ...FACTS_EMAIL,
  bookings: { bk2: { status: "booked", ...SLOT_NO_EMAIL, updatedAt: base.createdAt, replacedBy: null, slotTaken: false } },
  contact: { first_name: "Ana", last_name: "Ruiz", email: null },
};

const HEAD = { kind: "aiAct", mark: { kind: "ai" as const, label: "Sofía · AI" }, status: null, time: "9:42 AM", dateTime: base.createdAt };

function specimen(key: string, tr: Tr, act: AiAct, facts: ActFacts | null) {
  const view = buildActView(act, facts, { tr, zone: "America/Chicago", personaName: "Sofía", names: { user_dan: "Dan López" }, viewerId: "user_me", accountId: base.accountId });
  return <ActRow key={key} head={{ ...HEAD, verb: view.verb, detail: view.detail }} act={view} accountId={base.accountId} locale={tr.locale} />;
}

export function AiActsDemo() {
  return (
    <div className="flex w-full flex-col gap-6">
      {LOCALES.map(({ key, tr }) => (
        <div key={key} data-sg-ai-acts={key} className="flex min-w-0 max-w-[480px] flex-col gap-0 rounded-[var(--radius-card)] border border-[var(--line)] p-2">
          <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{key}</p>
          {specimen("field", tr, ACTS.field!, FACTS_EMAIL)}
          {specimen("booking-email", tr, ACTS.bookingEmail!, FACTS_EMAIL)}
          {specimen("booking-no-email", tr, ACTS.bookingNoEmail!, FACTS_NO_EMAIL)}
          {specimen("contact", tr, ACTS.contact!, FACTS_EMAIL)}
          {specimen("blocked", tr, ACTS.blocked!, FACTS_EMAIL)}
          {specimen("undone", tr, ACTS.undone!, FACTS_EMAIL)}
          {specimen("unknown", tr, ACTS.unknown!, null)}
        </div>
      ))}
    </div>
  );
}
