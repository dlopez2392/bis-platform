import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-10-09T16:12:00Z";
const msg = (id: string, direction: "inbound" | "outbound", channel: string, body: string): TimelineEntry => ({
  kind: "message", id, at: AT, contactId: "c1", message: { id, channel, direction, status: "delivered", subject: null, body, error: null,
    created_at: AT, author_kind: direction === "inbound" ? "customer" : "person", author_id: null } } as unknown as TimelineEntry);
const ENTRIES: TimelineEntry[] = [
  msg("m1", "inbound", "sms", "Necesito cambiar mi cita"),
  msg("m2", "outbound", "sms", "Claro, le escribimos"),
  { kind: "submission", id: "s1", at: AT, contactId: "c1", submission: { id: "s1", created_at: AT, formName: "Contacto", author_kind: "customer",
    answers: [{ key: "msg", label: "Mensaje", value: "Tengo una gotera" }] } } as unknown as TimelineEntry,
  { kind: "submission", id: "s2", at: AT, contactId: "c1", submission: { id: "s2", created_at: AT, formName: "Contacto", author_kind: "ai",
    answers: [{ key: "msg", label: "Mensaje", value: "Written by the AI" }] } } as unknown as TimelineEntry,
  { kind: "booking", id: "b1", at: AT, contactId: "c1", booking: { id: "b1", contact_id: "c1", created_at: AT, starts_at: AT, status: "booked",
    note: "Traigan escalera", author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } } as unknown as TimelineEntry,
  { kind: "booking", id: "b2", at: AT, contactId: "c1", booking: { id: "b2", contact_id: "c1", created_at: AT, starts_at: AT, status: "booked",
    note: "Staff note", author_kind: "person", author_id: "u1", rescheduled_from_id: null, moved_from_starts_at: null } } as unknown as TimelineEntry,
];
const render = (customerLang: "" | "en" | "es") => {
  const tr = makeTr("en");
  const base = legacyTimeline({ accountId: "a1", contactId: "c1" });
  const rows = timelineRows(ENTRIES, { zone: "UTC", tr, author: { viewerId: null, names: {}, personaName: null, tr } });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, customerLang }));
};

describe("customer-typed text carries the contact's language (S-09 §9, C10)", () => {
  it("an inbound text, a customer's form answer and a customer's booking note take it (mutation: drop the prop -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<p lang="es"[^>]*>Necesito cambiar mi cita<\/p>/);
    expect(html).toMatch(/<dd lang="es"[^>]*>Tengo una gotera<\/dd>/);
    expect(html).toMatch(/<p lang="es"[^>]*>Traigan escalera<\/p>/);
  });
  it("what the business wrote stays lang=\"\": an outbound text and a staff booking note (mutation: tag every message, or drop the booking author_kind check -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<p lang=""[^>]*>Claro, le escribimos<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>Staff note<\/p>/);
  });
  it("an AI-written submission's answers stay lang=\"\" (mutation: drop `e.submission.author_kind === \"customer\"` -> FAILS)", () => {
    expect(render("es")).toMatch(/<dd lang=""[^>]*>Written by the AI<\/dd>/);
  });
  it("a contact with no language keeps lang=\"\" (mutation: fall back to the account's language -> FAILS)", () => {
    expect(render("")).toMatch(/<p lang=""[^>]*>Necesito cambiar mi cita<\/p>/);
  });
});
