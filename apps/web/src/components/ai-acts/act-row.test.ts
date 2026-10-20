import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiAct } from "@bis/db/ai-act-rules";
import { buildActView } from "@/lib/ai-acts/view";
import { makeTr } from "@/lib/record/copy";
import type { ActFacts } from "@/lib/ai-acts/kinds/types";
import { ActRow } from "./act-row";

/**
 * The act row's markup (item 8c, plan Task 6): no DOM (no jsdom) — what the buttons DO is
 * undo-handlers.test.ts's, and in the browser the e2e's (Task 7). `ActUndo` is a `"use client"` child;
 * `renderToStaticMarkup` draws it exactly as the server would hand it to the browser (suggestion-actions
 * is the precedent: a client component renders fine here, nothing in it runs an effect).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const base = {
  id: "act1", accountId: "a1", contactId: "c1", actor: "voice" as const, callId: "call1", chatId: null,
  createdAt: "2026-10-19T16:00:00.000Z", undoneAt: null, undoneBy: null, undoNotified: false,
};
const filled = (over: Partial<AiAct> = {}): AiAct => ({
  ...base, kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value: "ana@example.com" }, ...over,
} as AiAct);
const booked = (over: Partial<AiAct> = {}): AiAct => ({
  ...base, kind: "booking_created", target: { bookingId: "b1" }, before: null,
  after: { startsAt: "2026-10-21T20:00:00.000Z", endsAt: "2026-10-21T21:00:00.000Z" }, ...over,
} as AiAct);
const made = (over: Partial<AiAct> = {}): AiAct => ({ ...base, kind: "contact_created", target: {}, before: null, after: null, ...over } as AiAct);

const facts = (over: Partial<ActFacts> = {}): ActFacts => ({
  now: NOW, contact: { first_name: "Ana", last_name: "Ruiz", email: "ana@example.com" }, heldBy: {}, editors: {}, canDelete: true, futureBooked: [],
  bookings: { b1: { status: "booked", startsAt: "2026-10-21T20:00:00.000Z", endsAt: "2026-10-21T21:00:00.000Z", updatedAt: "2026-10-19T16:00:00.000Z", replacedBy: null, slotTaken: false } },
  ...over,
});
const view = (act: AiAct, f: ActFacts | null, locale: "en" | "es" = "en") => buildActView(act, f, {
  tr: makeTr(locale), zone: ZONE, personaName: "Sofía", names: { user_ana: "Ana López" }, viewerId: "user_me", accountId: "a1",
});
const head = { kind: "aiAct", mark: { kind: "ai" as const, label: "Sofía · AI" }, verb: "x", status: null, detail: null, time: "10:00 AM", dateTime: "2026-10-19T16:00:00.000Z" };
const html = (act: AiAct, f: ActFacts | null, locale: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(ActRow, { head, act: view(act, f, locale), accountId: "a1", locale }));
const buttons = (h: string) => h.match(/<button[^>]*>.*?<\/button>/g) ?? [];
const variant = (b: string) => /data-variant="([a-z]+)"/.exec(b)?.[1];

describe("ActRow: no primary on the row itself (DESIGN.md rule 8, 2026-10-19 amendment)", () => {
  it("a field act, still safe, renders ZERO primary buttons and ONE ghost Undo (mutation: variant='default' on the row's Undo -> FAILS)", () => {
    const b = buttons(html(filled(), facts()));
    expect(b).toHaveLength(1);
    expect(variant(b[0]!)).toBe("ghost");
    expect(b[0]).toContain(">Undo<");
  });

  it("a blocked act shows its reason in words and no button at all", () => {
    const b = buttons(html(booked(), facts({ bookings: { b1: { status: "cancelled", startsAt: "2026-10-21T20:00:00.000Z", endsAt: "2026-10-21T21:00:00.000Z", updatedAt: "2026-10-19T16:00:00.000Z", replacedBy: null, slotTaken: false } } })));
    expect(b).toHaveLength(0);
    expect(html(booked(), facts({ bookings: { b1: { status: "cancelled", startsAt: "2026-10-21T20:00:00.000Z", endsAt: "2026-10-21T21:00:00.000Z", updatedAt: "2026-10-19T16:00:00.000Z", replacedBy: null, slotTaken: false } } }))).toContain("Already cancelled");
  });

  it("the blocked reason reads in Spanish too (mutation: hard-code English -> FAILS)", () => {
    const f = facts({ bookings: { b1: { status: "cancelled", startsAt: "2026-10-21T20:00:00.000Z", endsAt: "2026-10-21T21:00:00.000Z", updatedAt: "2026-10-19T16:00:00.000Z", replacedBy: null, slotTaken: false } } });
    expect(html(booked(), f, "es")).toContain("Ya se canceló");
  });

  it("an undone act reads its stamp, and no button", () => {
    const h = html(filled({ undoneAt: "2026-10-20T13:00:00.000Z", undoneBy: "user_me" }), facts());
    expect(buttons(h)).toHaveLength(0);
    expect(h).toContain("Undone by You");
  });

  it("an unknown act (the facts read failed) renders no button and no reason line", () => {
    const h = html(filled(), null);
    expect(buttons(h)).toHaveLength(0);
    expect(h).not.toContain("data-ai-act-line");
  });

  it("carries the reader's lang (mutation: drop it -> FAILS)", () => {
    expect(html(filled(), facts())).toMatch(/<div lang="en" data-ai-act-row="">/);
    expect(html(filled(), facts(), "es")).toMatch(/<div lang="es" data-ai-act-row="">/);
  });

  it("the source line links to the call; a web-chat act has no link (mutation: link the chat source -> FAILS)", () => {
    expect(html(filled(), facts())).toMatch(/<a[^>]*data-ai-act-source=""[^>]*href="\/dashboard\/accounts\/a1\/calls\/call1"/);
    const chatAct = made({ actor: "webchat", chatId: "chat1", callId: null });
    const h = html(chatAct, facts({ heldBy: { act1: [] } }));
    expect(h).not.toMatch(/<a[^>]*data-ai-act-source/);
    expect(h).toContain("From the website chat");
  });

  it("a contact act's Undo is a ghost button that opens a dialog (one trigger button, ghost)", () => {
    const b = buttons(html(made(), facts({ heldBy: { act1: [] } })));
    expect(b).toHaveLength(1);
    expect(variant(b[0]!)).toBe("ghost");
  });

  it("a booking act's Undo is a ghost button that opens a popover (one trigger button, ghost)", () => {
    const b = buttons(html(booked(), facts()));
    expect(b).toHaveLength(1);
    expect(variant(b[0]!)).toBe("ghost");
  });
});
