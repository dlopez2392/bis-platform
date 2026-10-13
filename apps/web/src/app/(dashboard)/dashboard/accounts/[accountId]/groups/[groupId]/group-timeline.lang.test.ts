import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/record/record-card", () => ({
  RecordCardRetry: (p: Record<string, unknown>) => createElement("button", { type: "button", "data-retry": "" }, p.label as string),
}));

const { GroupTimeline } = await import("./group-timeline");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-10-09T16:12:00Z";
const msg = (id: string, contactId: string, body: string): TimelineEntry => ({
  kind: "message", id, at: AT, contactId, message: { id, channel: "sms", direction: "inbound", status: "delivered", subject: null, body,
    error: null, created_at: AT, author_kind: "customer", author_id: null } } as unknown as TimelineEntry);
const ENTRIES: TimelineEntry[] = [msg("m1", "c1", "Necesito cambiar mi cita"), msg("m2", "c2", "I need to reschedule")];
// review I-3: what c1 (a Spanish speaker) did NOT type. Each stays lang="" even though c1 has a language.
const NOT_TYPED: TimelineEntry[] = [
  { kind: "message", id: "m3", at: AT, contactId: "c1", message: { id: "m3", channel: "sms", direction: "outbound", status: "delivered", subject: null,
    body: "Claro, le escribimos", error: null, created_at: AT, author_kind: "person", author_id: "u1" } } as unknown as TimelineEntry,
  { kind: "booking", id: "b1", at: AT, contactId: "c1", booking: { id: "b1", contact_id: "c1", created_at: AT, starts_at: AT, status: "booked",
    note: "Staff note", author_kind: "person", author_id: "u1", rescheduled_from_id: null, moved_from_starts_at: null } } as unknown as TimelineEntry,
  { kind: "submission", id: "s1", at: AT, contactId: "c1", submission: { id: "s1", created_at: AT, formName: "Contacto", author_kind: "ai",
    answers: [{ key: "msg", label: "Mensaje", value: "Written by the AI" }] } } as unknown as TimelineEntry,
];

function render(customerLangs: Record<string, "en" | "es">, entries: TimelineEntry[] = ENTRIES) {
  const tr = makeTr("en");
  const rows = timelineRows(entries, { zone: "UTC", tr, author: { viewerId: null, names: {}, personaName: null, tr } });
  return renderToStaticMarkup(createElement(GroupTimeline, {
    accountId: "a1", timezone: "UTC", rows, failedText: null, emptyText: null,
    pager: { olderHref: null, newerHref: null }, tr, customerLangs,
  } as never));
}

describe("GroupTimeline: each member's own language (S-09 §9)", () => {
  it("c1's inbound text carries 'es'; c2's, with no language, stays lang=\"\" (mutation: one language for the whole group -> FAILS)", () => {
    const html = render({ c1: "es" });
    expect(html).toMatch(/<p lang="es"[^>]*>Necesito cambiar mi cita<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>I need to reschedule<\/p>/);
  });
  it("an outbound text to a Spanish speaker stays lang=\"\" (mutation: tag every message -> FAILS)", () => {
    expect(render({ c1: "es" }, NOT_TYPED)).toMatch(/<p lang=""[^>]*>Claro, le escribimos<\/p>/);
  });
  it("a staff booking note (author_kind person) stays lang=\"\" (mutation: drop the booking author_kind check -> FAILS)", () => {
    expect(render({ c1: "es" }, NOT_TYPED)).toMatch(/<p lang=""[^>]*>Staff note<\/p>/);
  });
  it("an AI-written submission's answers stay lang=\"\" (mutation: drop the submission author_kind check -> FAILS)", () => {
    expect(render({ c1: "es" }, NOT_TYPED)).toMatch(/<dd lang=""[^>]*>Written by the AI<\/dd>/);
  });
});
