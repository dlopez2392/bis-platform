import { describe, expect, it } from "vitest";
import { AI_ACT_KINDS, type AiAct } from "@bis/db/ai-act-rules";
import { makeTr } from "@/lib/record/copy";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { ACT_KINDS, describeAct, stillSafeOf } from "./index";
import type { ActBookingFact, ActFacts } from "./types";

/**
 * The act-kind registry (item 8c, plan Task 5 item 1). Every date below is typed out, never built with
 * formatWhen: the zone is Tokyo (UTC+9), far from any machine this runs on, so a kind that formats in the
 * machine's zone, or in the wrong instant, fails here by name.
 */

const ZONE = "Asia/Tokyo";
const en = makeTr("en");
const es = makeTr("es");
const NOW = new Date("2026-10-20T12:00:00.000Z");
const FUTURE = "2026-10-21T20:00:00.000Z";       // Thu, Oct 22, 5:00 AM in Tokyo
const FUTURE_END = "2026-10-21T21:00:00.000Z";
const OLD = "2026-10-20T15:30:00.000Z";          // Wed, Oct 21, 12:30 AM in Tokyo
const OLD_END = "2026-10-20T16:30:00.000Z";
const VERSION = "2026-10-19T09:00:00.123Z";

const base = { id: "act1", accountId: "a1", contactId: "c1", actor: "voice" as const, callId: "call1", chatId: null,
  createdAt: "2026-10-19T08:00:00.000Z", undoneAt: null, undoneBy: null, undoNotified: false };
const created = (): AiAct => ({ ...base, kind: "booking_created", target: { bookingId: "b1" }, before: null, after: { startsAt: FUTURE, endsAt: FUTURE_END } });
const moved = (): AiAct => ({ ...base, kind: "booking_rescheduled", target: { bookingId: "bNew", fromBookingId: "bOld" },
  before: { startsAt: OLD, endsAt: OLD_END, version: VERSION }, after: { startsAt: FUTURE, endsAt: FUTURE_END } });
const cancelled = (): AiAct => ({ ...base, kind: "booking_cancelled", target: { bookingId: "b1" }, before: { startsAt: FUTURE, endsAt: FUTURE_END }, after: { version: VERSION } });
const contactMade = (): AiAct => ({ ...base, kind: "contact_created", target: {}, before: null, after: null });
const filled = (field: "firstName" | "lastName" | "email" | "phone" = "email", value = "ana@example.com", before: string | null = null): AiAct =>
  ({ ...base, kind: "contact_field_filled", target: { field }, before: { value: before }, after: { value } });

const booking = (over: Partial<ActBookingFact> = {}): ActBookingFact =>
  ({ status: "booked", startsAt: FUTURE, endsAt: FUTURE_END, updatedAt: "2026-10-19T08:00:00.000Z", replacedBy: null, slotTaken: false, ...over });
const facts = (over: Partial<ActFacts> = {}): ActFacts =>
  ({ now: NOW, bookings: {}, contact: null, heldBy: {}, editors: {}, canDelete: true, futureBooked: [], ...over });

describe("the registry", () => {
  it("has exactly one module per kind 0091's CHECK allows, each under its own name", () => {
    expect(Object.keys(ACT_KINDS).sort()).toEqual([...AI_ACT_KINDS].sort());
    for (const k of AI_ACT_KINDS) expect(ACT_KINDS[k].kind).toBe(k);
  });
  it("names the control each kind's Undo uses", () => {
    expect(Object.fromEntries(AI_ACT_KINDS.map((k) => [k, ACT_KINDS[k].control]))).toEqual({
      booking_created: "booking", booking_rescheduled: "booking", booking_cancelled: "booking",
      contact_created: "contact", contact_field_filled: "field",
    });
  });
});

describe("describe, in English, Spanish and the pseudo-locale, in the account's zone", () => {
  it("a booking: the time Sofía booked", () => {
    expect(describeAct(created(), { tr: en, zone: ZONE })).toEqual({ verb: "booked Thu, Oct 22, 5:00 AM GMT+9", detail: null });
    expect(describeAct(created(), { tr: es, zone: ZONE })).toEqual({ verb: "reservó jue, 22 de oct, 5:00 a.m. GMT+9", detail: null });
  });
  it("a move: the new time, and the old one as its detail", () => {
    expect(describeAct(moved(), { tr: en, zone: ZONE }))
      .toEqual({ verb: "moved a booking to Thu, Oct 22, 5:00 AM GMT+9", detail: "From Wed, Oct 21, 12:30 AM GMT+9" });
    expect(describeAct(moved(), { tr: es, zone: ZONE }))
      .toEqual({ verb: "movió una cita al jue, 22 de oct, 5:00 a.m. GMT+9", detail: "Antes: mié, 21 de oct, 12:30 a.m. GMT+9" });
  });
  it("a cancel: the time that was cancelled", () => {
    expect(describeAct(cancelled(), { tr: en, zone: ZONE })).toEqual({ verb: "cancelled the booking on Thu, Oct 22, 5:00 AM GMT+9", detail: null });
    expect(describeAct(cancelled(), { tr: es, zone: ZONE })).toEqual({ verb: "canceló la cita del jue, 22 de oct, 5:00 a.m. GMT+9", detail: null });
  });
  it("a new customer", () => {
    expect(describeAct(contactMade(), { tr: en, zone: ZONE })).toEqual({ verb: "added this customer", detail: null });
    expect(describeAct(contactMade(), { tr: es, zone: ZONE })).toEqual({ verb: "agregó a este cliente", detail: null });
  });
  it("a filled field: the field's own words and what she wrote", () => {
    expect(describeAct(filled(), { tr: en, zone: ZONE })).toEqual({ verb: "filled in the email: ana@example.com", detail: null });
    expect(describeAct(filled("phone", "+19565550100"), { tr: es, zone: ZONE })).toEqual({ verb: "completó el teléfono: +19565550100", detail: null });
    expect(describeAct(filled("firstName", "Ana"), { tr: en, zone: ZONE }).verb).toBe("filled in the first name: Ana");
    expect(describeAct(filled("lastName", "Ruiz"), { tr: es, zone: ZONE }).verb).toBe("completó el apellido: Ruiz");
  });
  it("the pseudo-locale wraps the whole sentence, so a missed key shows", () => {
    const ps = makeTr("en", true);
    expect(describeAct(moved(), { tr: ps, zone: ZONE }))
      .toEqual({ verb: pseudoLocale("moved a booking to Thu, Oct 22, 5:00 AM GMT+9"), detail: pseudoLocale("From Wed, Oct 21, 12:30 AM GMT+9") });
  });
});

describe("stillSafe: booking_created (spec 4.2 row 1)", () => {
  it("a live future booking is safe", () => {
    expect(stillSafeOf(created(), facts({ bookings: { b1: booking() } }))).toEqual({ ok: true });
  });
  it("cancelled since: Already cancelled", () => {
    expect(stillSafeOf(created(), facts({ bookings: { b1: booking({ status: "cancelled" }) } }))).toEqual({ ok: false, reason: "alreadyCancelled" });
  });
  it("started: Already happened, and starting exactly now counts (0091: starts_at > p_now) (mutation: <= as < -> FAILS)", () => {
    expect(stillSafeOf(created(), facts({ bookings: { b1: booking({ startsAt: NOW.toISOString() }) } }))).toEqual({ ok: false, reason: "alreadyHappened" });
    expect(stillSafeOf(created(), facts({ bookings: { b1: booking({ startsAt: "2026-10-20T12:00:00.001Z" }) } }))).toEqual({ ok: true });
  });
  it("a booking the reader cannot see (gone, or behind RLS) offers no Undo", () => {
    expect(stillSafeOf(created(), facts())).toEqual({ ok: false, reason: "changed" });
  });
});

describe("stillSafe: booking_rescheduled (spec 4.2 row 2)", () => {
  const ok = () => facts({ bookings: {
    bNew: booking(),
    bOld: booking({ status: "cancelled", startsAt: OLD, endsAt: OLD_END, updatedAt: "2026-10-19T09:00:00.123+00:00" }),
  } });
  it("both untouched: safe (the version compared as an instant: PostgREST's +00:00 form matches the JS ISO string)", () => {
    expect(stillSafeOf(moved(), ok())).toEqual({ ok: true });
  });
  it("the new booking cancelled, replaced or started: Changed since", () => {
    const f = ok();
    expect(stillSafeOf(moved(), { ...f, bookings: { ...f.bookings, bNew: booking({ status: "cancelled" }) } })).toEqual({ ok: false, reason: "changed" });
    expect(stillSafeOf(moved(), { ...f, bookings: { ...f.bookings, bNew: booking({ replacedBy: "bNewer" }) } })).toEqual({ ok: false, reason: "changed" });
    expect(stillSafeOf(moved(), { ...f, bookings: { ...f.bookings, bNew: booking({ startsAt: NOW.toISOString() }) } })).toEqual({ ok: false, reason: "changed" });
  });
  it("the old booking's version moved: Changed since", () => {
    const f = ok();
    expect(stillSafeOf(moved(), { ...f, bookings: { ...f.bookings, bOld: { ...f.bookings.bOld!, updatedAt: "2026-10-19T09:00:00.124Z" } } }))
      .toEqual({ ok: false, reason: "changed" });
  });
  it("the old time passed: The time has passed", () => {
    const f = ok();
    expect(stillSafeOf(moved(), { ...f, bookings: { ...f.bookings, bOld: { ...f.bookings.bOld!, startsAt: NOW.toISOString() } } }))
      .toEqual({ ok: false, reason: "timePassed" });
  });
  it("the old slot taken: The old time is taken", () => {
    const f = ok();
    expect(stillSafeOf(moved(), { ...f, bookings: { ...f.bookings, bOld: { ...f.bookings.bOld!, slotTaken: true } } }))
      .toEqual({ ok: false, reason: "oldTimeTaken" });
  });
});

describe("stillSafe: booking_cancelled (spec 4.2 row 3)", () => {
  const ok = (over: Partial<ActBookingFact> = {}, f: Partial<ActFacts> = {}) =>
    facts({ bookings: { b1: booking({ status: "cancelled", updatedAt: VERSION, ...over }) }, ...f });
  it("still cancelled by her, free and ahead: safe", () => {
    expect(stillSafeOf(cancelled(), ok())).toEqual({ ok: true });
  });
  it("booked again: Already re-booked", () => {
    expect(stillSafeOf(cancelled(), ok({ status: "booked" }))).toEqual({ ok: false, reason: "rebooked" });
  });
  it("the time passed: The time has passed", () => {
    expect(stillSafeOf(cancelled(), ok({ startsAt: NOW.toISOString() }))).toEqual({ ok: false, reason: "timePassed" });
  });
  it("cancelled again since, or replaced: Changed since", () => {
    expect(stillSafeOf(cancelled(), ok({ updatedAt: "2026-10-19T10:00:00.000Z" }))).toEqual({ ok: false, reason: "changed" });
    expect(stillSafeOf(cancelled(), ok({ replacedBy: "b2" }))).toEqual({ ok: false, reason: "changed" });
  });
  it("the slot taken now: That time is taken now", () => {
    expect(stillSafeOf(cancelled(), ok({ slotTaken: true }))).toEqual({ ok: false, reason: "timeTaken" });
  });
  it("they booked another future time since: They booked another time since; this booking itself never counts", () => {
    expect(stillSafeOf(cancelled(), ok({}, { futureBooked: ["b9"] }))).toEqual({ ok: false, reason: "otherBooking" });
    expect(stillSafeOf(cancelled(), ok({}, { futureBooked: ["b1"] }))).toEqual({ ok: true });
  });
});

describe("stillSafe: contact_created (spec 4.2 row 4)", () => {
  it("only an Owner (or the agency) may remove a customer", () => {
    expect(stillSafeOf(contactMade(), facts({ canDelete: false, heldBy: { act1: [] } }))).toEqual({ ok: false, reason: "ownerOnly" });
  });
  it("nothing but her own call: safe", () => {
    expect(stillSafeOf(contactMade(), facts({ heldBy: { act1: [] } }))).toEqual({ ok: true });
  });
  it("a booking is its own reason, ahead of any other (owner Q4)", () => {
    expect(stillSafeOf(contactMade(), facts({ heldBy: { act1: ["notes", "bookings"] } }))).toEqual({ ok: false, reason: "hasBooking" });
  });
  it("anything else: Has other activity since", () => {
    expect(stillSafeOf(contactMade(), facts({ heldBy: { act1: ["notes"] } }))).toEqual({ ok: false, reason: "hasActivity" });
  });
  it("an answer the page does not hold is never read as safe", () => {
    expect(stillSafeOf(contactMade(), facts())).toEqual({ ok: false, reason: "hasActivity" });
  });
});

describe("stillSafe: contact_field_filled (spec 4.2 row 5)", () => {
  it("the field still holds exactly her stored value: safe; any other spelling is not, because the restore compares exactly (review M-3; mutation: compare through stillAsWritten -> FAILS)", () => {
    expect(stillSafeOf(filled(), facts({ contact: { email: "ana@example.com" } }))).toEqual({ ok: true });
    expect(stillSafeOf(filled("email", "kai@example.invalid"), facts({ contact: { email: "Kai@Example.invalid" } }))).toEqual({ ok: false, reason: "changed" });
    expect(stillSafeOf(filled(), facts({ contact: { email: " ana@example.com" } }))).toEqual({ ok: false, reason: "changed" });
  });
  it("changed by a person the page can name: Changed since by {name}", () => {
    expect(stillSafeOf(filled(), facts({ contact: { email: "x@example.com" }, editors: { act1: "user_ana" } }))).toEqual({ ok: false, reason: "changedBy" });
  });
  it("changed by no one the page can name, or emptied: Changed since", () => {
    expect(stillSafeOf(filled(), facts({ contact: { email: "x@example.com" }, editors: { act1: null } }))).toEqual({ ok: false, reason: "changed" });
    expect(stillSafeOf(filled(), facts({ contact: { email: null } }))).toEqual({ ok: false, reason: "changed" });
    expect(stillSafeOf(filled(), facts({ contact: null }))).toEqual({ ok: false, reason: "changed" });
  });
});
