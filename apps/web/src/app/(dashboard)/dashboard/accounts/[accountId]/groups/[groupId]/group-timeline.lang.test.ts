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

function render(customerLangs: Record<string, "en" | "es">) {
  const tr = makeTr("en");
  const rows = timelineRows(ENTRIES, { zone: "UTC", tr, author: { viewerId: null, names: {}, personaName: null, tr } });
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
});
