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
const ENTRIES: TimelineEntry[] = [
  { kind: "call", id: "k1", at: AT, call: { id: "k1", started_at: AT, outcome: "booked", duration_secs: 180, reason: "Se le gotea el techo", summary: "", language: "es" } },
  { kind: "booking", id: "b1", at: AT, booking: { id: "b1", created_at: AT, starts_at: "2026-10-16T15:00:00Z", status: "booked", note: null,
    author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } },
  { kind: "message", id: "m1", at: AT, message: { id: "m1", channel: "email", direction: "outbound", status: "delivered", subject: "Quote",
    body: "Here it is", error: null, created_at: AT, author_kind: "person", author_id: "user_dan" } },
  { kind: "deal", id: "d1", at: AT, deal: { id: "d1", name: "Deck build", status: "open", monetary_value: 2400, created_at: AT, created_by: null } },
  { kind: "note", id: "n1", at: AT, note: { id: "n1", body: "Gate code 4411", author_id: "user_me", created_at: AT } },
];
const render = (over: Record<string, unknown> = {}, locale: "en" | "es" = "en") => {
  const tr = makeTr(locale);
  const rows = timelineRows(ENTRIES, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: { user_dan: "Dan López" }, personaName: null, tr } });
  const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale, emailAction: async () => {}, smsAction: async () => {} });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null, ...over } as never));
};

describe("the 1b timeline (spec §6, §9.4)", () => {
  it("every row carries an author mark: a row with no mark is a defect (DESIGN.md Provenance; mutation: render the deal row without its mark -> FAILS)", () => {
    const html = render();
    const items = html.match(/data-timeline-item="/g) ?? [];
    expect(items).toHaveLength(ENTRIES.length);
    expect(html.match(/data-author-mark="/g)).toHaveLength(ENTRIES.length);
    for (const label of ["Sofía · AI", "Customer", "Dan López", "Someone on the team", "You"]) expect(html).toContain(`>${label}<`);
  });
  it("a call row links to its call page and keeps the caller's language; typed text is lang=\"\" (C11; mutation: drop lang on the call's words -> FAILS)", () => {
    const html = render();
    expect(html).toContain('href="/dashboard/accounts/a1/calls/k1"');
    expect(html).toMatch(/<p lang="es"[^>]*>Se le gotea el techo<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>Gate code 4411<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>Here it is<\/p>/);
  });
  it("one pager at the foot, Older and Newer as given, labelled; none when there is nowhere to go (mutation: always render the pager -> FAILS)", () => {
    const html = render({ pager: { olderHref: "/x?before=abc#record-timeline", newerHref: "/x#record-timeline" } });
    expect(html.match(/data-timeline-pager/g)).toHaveLength(1);
    expect(html).toMatch(/<nav aria-label="Pages"/);
    expect(html).toContain('href="/x?before=abc#record-timeline"');
    expect(html.indexOf(">Newer<")).toBeLessThan(html.indexOf(">Older<"));
    expect(html.lastIndexOf("data-timeline-item")).toBeLessThan(html.indexOf("data-timeline-pager"));
    expect(render()).not.toContain("data-timeline-pager");
  });
  it("some sources failed: the rows that loaded, and above them what could not be (spec §9.4; mutation: drop the notice -> FAILS)", () => {
    const html = render({ failedText: "Couldn't load calls and bookings." });
    expect(html).toMatch(/role="alert"[^>]*data-timeline-failed|data-timeline-failed[^>]*role="alert"/);
    expect(html).toContain("Couldn&#x27;t load calls and bookings.");
    expect(html.indexOf("data-timeline-failed")).toBeLessThan(html.indexOf("data-timeline-item"));
  });
  it("the failure notice carries Try again, a re-read of this same page, and only when something failed (orchestrator rule; mutation: drop the retry -> FAILS)", () => {
    const notice = render({ failedText: "Couldn't load calls." }).match(/<div[^>]*data-timeline-failed[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(notice).toContain(">Try again<");
    expect(render()).not.toContain(">Try again<");
  });
  it("the empty state sells the timeline, only when told to (rule 5)", () => {
    const empty = render({ rows: [], emptyText: "Texts, calls, bookings, notes and To-dos with this customer show up here." });
    expect(empty).toContain("Texts, calls, bookings, notes and To-dos with this customer show up here.");
    expect(render()).not.toContain("show up here");
  });
  it("in Spanish the chrome and rows read Spanish (mutation: leave the To-do form on m[...] -> FAILS)", () => {
    const html = render({}, "es");
    for (const s of [">Agregar<", ">Cliente<", ">Usted<", "contestó una llamada", "Nuevo pendiente…"]) expect(html).toContain(s);
  });
});
