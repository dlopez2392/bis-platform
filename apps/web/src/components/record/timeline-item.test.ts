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

describe("TimelineItem: the member a row is about (S-03 part 2b, C8) — the mark after it still says who did it", () => {
  const WITHOUT_SUBJECT =
    '<div data-timeline-item="booking" class="flex items-start gap-3 py-[7px]"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-check mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path><path d="m9 16 2 2 4-4"></path></svg><div class="min-w-0 flex-1"><p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm"><span data-author-mark="customer" title="Customer" class="inline-flex max-w-[14rem] shrink-0 items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 text-[10px] leading-4 font-medium text-[var(--chip-text)]"><span class="truncate">Customer</span></span><span class="min-w-0 break-words font-medium text-card-foreground">booked an appointment for Thu, Oct 16, 10:00 AM</span><span aria-hidden="true" class="text-muted-foreground">·</span><time dateTime="2026-10-09T21:12:00Z" class="text-xs text-muted-foreground tabular-nums">Oct 9, 2026, 4:12 PM</time></p></div></div>';

  it("without a subject, the markup is byte-identical to before this change (mutation: always render an empty subject span -> FAILS)", () => {
    expect(render()).toBe(WITHOUT_SUBJECT);
  });

  it("with a subject, the head line reads member · mark · verb, the member a focusable link (mutation: drop data-timeline-subject -> FAILS)", () => {
    const html = render({ subject: { label: "Ana García", href: "/dashboard/accounts/a1/contacts/c1" } });
    const at = (s: string) => html.indexOf(s);
    expect(at("Ana García")).toBeGreaterThan(-1);
    expect(at("Ana García")).toBeLessThan(at('data-author-mark="customer"'));
    expect(at('data-author-mark="customer"')).toBeLessThan(at("booked an appointment"));
    expect(html).toMatch(/<a[^>]*data-timeline-subject[^>]*href="\/dashboard\/accounts\/a1\/contacts\/c1"[^>]*>Ana García<\/a>/);
    expect(html).toMatch(/focus-visible:ring-\[3px\]/);
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
