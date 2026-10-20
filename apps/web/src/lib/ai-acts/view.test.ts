import { describe, expect, it } from "vitest";
import type { AiAct } from "@bis/db/ai-act-rules";
import { makeTr } from "@/lib/record/copy";
import type { ActFacts } from "./kinds/types";
import { buildActView, typedNameMatches, type ActViewCtx } from "./view";

/**
 * The row's view (item 8c, plan Task 5 item 3): built on the server from the registry and the page's one
 * facts read, handed to the client as plain data. Dates typed out, in Tokyo (UTC+9).
 */

const ZONE = "Asia/Tokyo";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const base = { id: "act1", accountId: "a1", contactId: "c1", actor: "voice" as const, callId: "call1", chatId: null,
  createdAt: "2026-10-19T16:00:00.000Z", undoneAt: null, undoneBy: null, undoNotified: false };
const booked = (over: Partial<AiAct> = {}): AiAct =>
  ({ ...base, kind: "booking_created", target: { bookingId: "b1" }, before: null, after: { startsAt: "2026-10-21T20:00:00.000Z", endsAt: "2026-10-21T21:00:00.000Z" }, ...over } as AiAct);
const filled = (over: Partial<AiAct> = {}): AiAct =>
  ({ ...base, kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value: "ana@example.com" }, ...over } as AiAct);
const made = (over: Partial<AiAct> = {}): AiAct =>
  ({ ...base, kind: "contact_created", target: {}, before: null, after: null, ...over } as AiAct);

const facts = (over: Partial<ActFacts> = {}): ActFacts => ({
  now: NOW, contact: { first_name: "Ana", last_name: "Ruiz", email: "ana@example.com" }, heldBy: {}, editors: {}, canDelete: true, futureBooked: [],
  bookings: { b1: { status: "booked", startsAt: "2026-10-21T20:00:00.000Z", endsAt: "2026-10-21T21:00:00.000Z", updatedAt: "2026-10-19T16:00:00.000Z", replacedBy: null, slotTaken: false } },
  ...over,
});
const ctx = (over: Partial<ActViewCtx> = {}): ActViewCtx =>
  ({ tr: makeTr("en"), zone: ZONE, personaName: "Lupe", names: { user_ana: "Ana López" }, viewerId: "user_me", accountId: "a1", ...over });

describe("buildActView: the sentence and its source", () => {
  it("a voice act names the call's day in the account's zone and links to the call", () => {
    const v = buildActView(booked(), facts(), ctx());
    expect(v).toMatchObject({ id: "act1", kind: "booking_created", verb: "booked Thu, Oct 22, 5:00 AM GMT+9", detail: null, persona: "Lupe" });
    // The redo toast's {persona}: the account's name for her, else Sofía (the AI mark's own rule).
    expect(buildActView(booked(), facts(), ctx({ personaName: "  " })).persona).toBe("Sofía");
    expect(v.source).toEqual({ label: "From the call on Oct 20, 2026", href: "/dashboard/accounts/a1/calls/call1" });
    expect(buildActView(booked(), facts(), ctx({ tr: makeTr("es") })).source.label).toBe("De la llamada del 20 oct 2026");
  });
  it("a web-chat act says so and links nowhere: there is no chat page to open (mutation: link the chat source -> FAILS)", () => {
    const v = buildActView(made({ actor: "webchat", callId: null, chatId: "chat1" }), facts({ heldBy: { act1: [] } }), ctx());
    expect(v.source).toEqual({ label: "From the website chat", href: null });
    expect(buildActView(made({ actor: "webchat", callId: null, chatId: "chat1" }), facts(), ctx({ tr: makeTr("es") })).source)
      .toEqual({ label: "Del chat del sitio web", href: null });
  });
});

describe("typedNameMatches: the contact Undo's typed confirmation", () => {
  it("matches the header's name in purgeNameKey's form: whitespace runs as one space, case kept, no trim", () => {
    const c = { first_name: "Ana", last_name: "Ruiz" };
    expect(typedNameMatches("Ana Ruiz", c)).toBe(true);
    expect(typedNameMatches("Ana   Ruiz", c)).toBe(true);
    expect(typedNameMatches("ana ruiz", c)).toBe(false);
    expect(typedNameMatches("Ana Rui", c)).toBe(false);
    expect(typedNameMatches("", c)).toBe(false);
  });
  it("a customer with no name is confirmed by the placeholder in either language the page may show", () => {
    expect(typedNameMatches("(no name)", { first_name: null, last_name: null })).toBe(true);
    expect(typedNameMatches("(sin nombre)", { first_name: " ", last_name: null })).toBe(true);
    expect(typedNameMatches("", { first_name: null, last_name: null })).toBe(false);
  });
});

describe("buildActView: the Undo state", () => {
  it("available: a booking's control offers the notice by the customer's name when they have an email", () => {
    expect(buildActView(booked(), facts(), ctx()).undo)
      .toEqual({ state: "available", control: "booking", notify: { name: "Ana Ruiz" }, contactName: "Ana Ruiz", fieldLabel: null, fieldWasEmpty: false });
  });
  it("available: with no email, the notice says to call them instead, in the reader's language", () => {
    const f = facts({ contact: { first_name: "Ana", last_name: null, email: null } });
    expect(buildActView(booked(), f, ctx()).undo).toEqual({
      state: "available", control: "booking", contactName: "Ana", fieldLabel: null, fieldWasEmpty: false,
      notify: { none: "Ana has no email on file, so they won't be told. Call them if they need to know." },
    });
    expect(buildActView(booked(), f, ctx({ tr: makeTr("es") })).undo).toMatchObject({
      notify: { none: "Este cliente no tiene correo registrado, así que no se le avisará. Llámele si Ana necesita saberlo." },
    });
  });
  it("available: a field or a contact carries no notice", () => {
    expect(buildActView(filled(), facts(), ctx()).undo).toEqual({ state: "available", control: "field", notify: null, contactName: "Ana Ruiz", fieldLabel: "email", fieldWasEmpty: true });
    expect(buildActView(filled(), facts(), ctx({ tr: makeTr("es") })).undo).toMatchObject({ fieldLabel: "el correo" });
    expect(buildActView(made(), facts({ heldBy: { act1: [] } }), ctx()).undo).toEqual({ state: "available", control: "contact", notify: null, contactName: "Ana Ruiz", fieldLabel: null, fieldWasEmpty: false });
  });
  it("blocked: the reason in words, in the reader's language", () => {
    const f = facts({ bookings: { b1: { ...facts().bookings.b1!, status: "cancelled" } } });
    expect(buildActView(booked(), f, ctx()).undo).toEqual({ state: "blocked", line: "Already cancelled" });
    expect(buildActView(booked(), f, ctx({ tr: makeTr("es") })).undo).toEqual({ state: "blocked", line: "Ya se canceló" });
    expect(buildActView(made(), facts({ canDelete: false }), ctx()).undo).toEqual({ state: "blocked", line: "Only an Owner can remove a customer" });
  });
  it("blocked: a field changed since by a person reads their name, or Someone on the team when the page cannot name them", () => {
    const f = facts({ contact: { first_name: "Ana", email: "other@example.com" }, editors: { act1: "user_ana" } });
    expect(buildActView(filled(), f, ctx()).undo).toEqual({ state: "blocked", line: "Changed by Ana López since" });
    expect(buildActView(filled(), { ...f, editors: { act1: "user_gone" } }, ctx()).undo).toEqual({ state: "blocked", line: "Changed by Someone on the team since" });
    expect(buildActView(filled(), { ...f, editors: { act1: "user_me" } }, ctx()).undo).toEqual({ state: "blocked", line: "Changed by You since" });
  });
  it("undone: names You for the viewer, the person by name, and Someone on the team when unnamed, with the day", () => {
    const at = "2026-10-20T01:00:00.000Z";
    expect(buildActView(booked({ undoneAt: at, undoneBy: "user_me" }), facts(), ctx()).undo).toEqual({ state: "undone", line: "Undone by You · Oct 20, 2026" });
    expect(buildActView(booked({ undoneAt: at, undoneBy: "user_ana" }), facts(), ctx()).undo).toEqual({ state: "undone", line: "Undone by Ana López · Oct 20, 2026" });
    expect(buildActView(booked({ undoneAt: at, undoneBy: "user_gone" }), facts(), ctx()).undo).toEqual({ state: "undone", line: "Undone by Someone on the team · Oct 20, 2026" });
    expect(buildActView(booked({ undoneAt: at, undoneBy: "user_gone" }), facts(), ctx({ tr: makeTr("es") })).undo)
      .toEqual({ state: "undone", line: "Deshecho por Alguien del equipo · 20 oct 2026" });
  });
  it("undone wins even when the facts read failed: the stamp is on the act itself", () => {
    expect(buildActView(booked({ undoneAt: "2026-10-20T01:00:00.000Z", undoneBy: "user_me" }), null, ctx()).undo.state).toBe("undone");
  });
  it("unknown: the facts read failed, so the row shows without an Undo", () => {
    expect(buildActView(booked(), null, ctx()).undo).toEqual({ state: "unknown" });
  });
});

describe("Task 9 fix round: what the controls need to word their toasts and dialog", () => {
  it("the view carries who acted, so the contact dialog and its toast can speak of the chat (review M-a; mutation: drop actor -> FAILS)", () => {
    expect(buildActView(made(), facts({ heldBy: { act1: [] } }), ctx()).actor).toBe("voice");
    expect(buildActView(made({ actor: "webchat", callId: null, chatId: "chat1" }), facts({ heldBy: { act1: [] } }), ctx()).actor).toBe("webchat");
  });
  it("a field's control knows whether the field was blank before her (design I-5; mutation: always true -> FAILS)", () => {
    const blank = buildActView(filled(), facts(), ctx()).undo;
    expect(blank).toMatchObject({ state: "available", control: "field", fieldWasEmpty: true });
    const held = buildActView(filled({ before: { value: "old@example.com" } } as Partial<AiAct>), facts(), ctx()).undo;
    expect(held).toMatchObject({ state: "available", control: "field", fieldWasEmpty: false });
    // A "Caller" placeholder first name is a value the Undo puts back, not a blank.
    const placeholder = buildActView(filled({ target: { field: "firstName" }, before: { value: "Caller" }, after: { value: "Ana" } } as Partial<AiAct>),
      facts({ contact: { first_name: "Ana", last_name: "Ruiz", email: "ana@example.com" } }), ctx()).undo;
    expect(placeholder).toMatchObject({ fieldWasEmpty: false });
  });
});
