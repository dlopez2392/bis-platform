import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarCheck } from "lucide-react";
import { TimelineItem, TimelineItemSkeleton } from "./timeline-item";

const base = {
  kind: "booking", icon: CalendarCheck, mark: { kind: "customer" as const, label: "Customer" },
  verb: "booked an appointment for Thu, Oct 16, 10:00 AM", time: "Oct 9, 2026, 4:12 PM", dateTime: "2026-10-09T21:12:00Z",
};
const render = (over: Record<string, unknown> = {}, body?: unknown) =>
  renderToStaticMarkup(createElement(TimelineItem, { ...base, ...over } as never, body as never));

describe("TimelineItem: mark · verb · status · detail · time, then the body (spec §8, §9.4)", () => {
  it("reads in that order (mutation: put the time before the mark -> FAILS)", () => {
    const html = render({ status: { tone: "accent", word: "Booked" }, detail: "Moved from Tue, Oct 14, 9:00 AM" });
    const at = (s: string) => html.indexOf(s);
    expect(at('data-author-mark="customer"')).toBeGreaterThan(-1);
    expect(at('data-author-mark="customer"')).toBeLessThan(at("booked an appointment"));
    expect(at("booked an appointment")).toBeLessThan(at(">Booked<"));
    expect(at(">Booked<")).toBeLessThan(at("Moved from"));
    expect(at("Moved from")).toBeLessThan(at("Oct 9, 2026, 4:12 PM"));
    expect(html).toContain('data-timeline-item="booking"');
  });
  it("a status is a dot and a word (rule 3; mutation: drop the word -> FAILS; drop the dot -> FAILS)", () => {
    const html = render({ status: { tone: "warn", word: "No-show" } });
    expect(html).toContain('data-timeline-status="warn"');
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*\bbg-\[var\(--warn\)\][^"]*"><\/span><span>No-show<\/span>/);
  });
  it("no status draws no dot; the time is a <time> with its instant", () => {
    const html = render();
    expect(html).not.toContain("data-timeline-status");
    expect(html).toMatch(/<time[^>]*datetime="2026-10-09T21:12:00Z"/i);
  });
  it("renders the body under the head line and the action beside it (mutation: drop children -> FAILS)", () => {
    const html = render({ action: createElement("button", null, "done") }, createElement("p", null, "Gate code 4411"));
    expect(html.indexOf("Oct 9, 2026, 4:12 PM")).toBeLessThan(html.indexOf("Gate code 4411"));
    expect(html).toContain(">done<");
  });
});

describe("TimelineItemSkeleton (rule 7: shaped like a row, never a spinner)", () => {
  it("draws one mark-chip, line and time per row (mutation: render one generic bar -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(TimelineItemSkeleton, { rows: 5 }));
    expect(html).toContain("data-record-skeleton");
    expect(html.match(/data-timeline-skeleton-row/g)).toHaveLength(5);
    expect(html).not.toMatch(/animate-spin|spinner/i);
  });
});
