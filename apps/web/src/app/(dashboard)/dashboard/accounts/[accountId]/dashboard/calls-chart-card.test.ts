import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallListRow } from "@bis/db";
import { CallsChartCard } from "./calls-chart-card";

// Same shape as calls-table.test.ts: a server component with no client state
// is just a function of its props, so `renderToStaticMarkup` pins the served
// output directly.

const BUCKETS: { dayKey: string; count: number; isWeekend: boolean }[] = [
  { dayKey: "2027-08-18", count: 5, isWeekend: false },
  { dayKey: "2027-08-19", count: 7, isWeekend: false },
  { dayKey: "2027-08-20", count: 6, isWeekend: false },
  { dayKey: "2027-08-21", count: 9, isWeekend: false },
  { dayKey: "2027-08-22", count: 8, isWeekend: false },
  { dayKey: "2027-08-23", count: 3, isWeekend: true },
  { dayKey: "2027-08-24", count: 4, isWeekend: true },
  { dayKey: "2027-08-25", count: 8, isWeekend: false },
  { dayKey: "2027-08-26", count: 10, isWeekend: false },
  { dayKey: "2027-08-27", count: 7, isWeekend: false },
  { dayKey: "2027-08-28", count: 11, isWeekend: false },
  { dayKey: "2027-08-29", count: 9, isWeekend: false },
  { dayKey: "2027-08-30", count: 5, isWeekend: true },
  { dayKey: "2027-08-31", count: 13, isWeekend: false },
];

const ZERO_BUCKETS = BUCKETS.map((b) => ({ ...b, count: 0 }));

const CALL: CallListRow = {
  id: "c1",
  // Deliberately microsecond-precision, as Postgres returns it — same fixture
  // shape as calls-table.test.ts's own ROW.
  started_at: "2026-08-25T19:15:00.123456+00:00",
  ended_at: "2026-08-25T19:17:12.000000+00:00",
  duration_secs: 132,
  outcome: "booked",
  language: "es",
  caller_e164: "+19565061545",
  contact_id: "ct1",
  conversation_id: "cv1",
  contact: { first_name: "Ana", last_name: "Reyes" },
};

function render(opts: {
  dayBuckets?: typeof BUCKETS;
  recentCalls?: CallListRow[];
  timezone?: string;
  isAgency?: boolean;
  voiceEnabled?: boolean;
} = {}) {
  return renderToStaticMarkup(
    createElement(CallsChartCard, {
      accountId: "acct1",
      timezone: opts.timezone ?? "America/Chicago",
      dayBuckets: opts.dayBuckets ?? BUCKETS,
      recentCalls: opts.recentCalls ?? [CALL],
      isAgency: opts.isAgency ?? true,
      voiceEnabled: opts.voiceEnabled ?? true,
    }),
  );
}

/** The markup of the ONE bar that owns a given tooltip string — from that
 *  bar's own `data-slot="chart-bar"` up to its tooltip text. This proves
 *  which treatment a SPECIFIC day's bar actually got, not just that both
 *  classes appear somewhere in the document.
 *
 *  Anchored on the slot rather than sliced by a fixed window: the window used
 *  to be 400 characters, and the tooltip's own class list grew past that when
 *  the chart language landed (`glass-overlay`, the mono type, the gridline
 *  divs) — a fixed window either stops short of the bar's class attribute or
 *  reaches back far enough to read the PREVIOUS day's bar and report its
 *  colour instead. Both failure modes are silent. */
function htmlBefore(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  expect(idx, `expected to find "${marker}" in the rendered HTML`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('data-slot="chart-bar"', idx);
  expect(start, `no chart-bar slot before "${marker}"`).toBeGreaterThan(-1);
  return html.slice(start, idx);
}

describe("CallsChartCard", () => {
  it("gives every one of the 14 bars a visible tooltip and an sr-only twin", () => {
    const html = render();
    expect(html).toContain("Aug 18 · 5 calls");
    expect(html).toContain("Aug 31 · 13 calls");
    expect(html).toContain("August 18, 5 calls");
    expect(html).toContain("August 31, 13 calls");
  });

  // RETARGETED with the chart-language rewrite, and RENAMED with it: the old
  // name said `bg-primary`/`bg-muted`, and a `-t` filter matching a stale
  // name skips silently rather than failing. Mirrors daily-chart.test.ts.
  it("weekday bars carry the accent gradient (bar-accent); weekend bars are muted (--bar-wk, never --surface-3)", () => {
    const html = render();
    const weekday = htmlBefore(html, "Aug 18 · 5 calls");
    expect(weekday).toContain("bar-accent");
    expect(weekday).not.toContain("bg-[var(--bar-wk)]");
    // The flat single hue and the 29%-too-bright weekend step are both gone.
    expect(html).not.toContain("bg-primary");
    expect(html).not.toContain("bg-muted");

    const weekend = htmlBefore(html, "Aug 23 · 3 calls");
    expect(weekend).toContain("bg-[var(--bar-wk)]");
    expect(weekend).not.toContain("bar-accent");
  });

  it("the busiest day is the sanctioned violet→cyan bar-hot, and it is the ONLY one", () => {
    const html = render();
    // Aug 31 = 13 calls, the window max.
    expect(htmlBefore(html, "Aug 31 · 13 calls")).toContain("bar-hot");
    expect(htmlBefore(html, "Aug 18 · 5 calls")).not.toContain("bar-hot");
    expect(html.match(/bar-hot/g)?.length).toBe(1);
  });

  it("bars sit on the --axis rule with two dashed gridlines and scale in PERCENT, not px", () => {
    const html = render();
    expect(html).toContain("border-b border-[var(--axis)]");
    expect(html.match(/data-slot="chart-grid"/g)?.length).toBe(2);
    // 5/13 of the plot, as a percentage — the px arithmetic against a
    // 113px content box is gone with the container's old padding.
    expect(html).toContain(`height:${(5 / 13) * 100}%`);
    expect(html).not.toMatch(/height:\d+px/);
  });

  it("the tooltip is a glass-overlay chip in mono — no bg-popover, no grey shadow-sm", () => {
    const html = render();
    expect(html).toContain("glass-overlay");
    expect(html).toContain("font-mono text-[10.5px]");
    expect(html).not.toContain("bg-popover");
    expect(html).not.toContain("shadow-sm");
  });

  // RETARGETED: the axis was three stray words spread by `justify-between`
  // (start date / "Weekends muted" / "Today"). It is now a 14-column mono row
  // with a label under EVERY day; "Weekends muted" moved out to a legend,
  // where it belongs, and "Today" left entirely — the last tick IS today and
  // carries its own date, so the word was a second name for the same mark.
  // `dashboard.calls.axis.today` was deleted from lib/messages.ts with it.
  it("axis: one mono tick under every one of the 14 days, thinned by parity, with the weekends legend beside it", () => {
    const html = render();
    expect(html).toContain('data-slot="chart-axis"');
    for (const tick of ["Aug 18", "Aug 23", "Aug 31"]) expect(html).toContain(tick);
    // 14 ticks, and the odd ones keep their column while hiding their text.
    expect(html.match(/min-w-0 flex-1 text-center font-mono/g)?.length).toBe(14);
    expect(html.match(/hidden xl:inline/g)?.length).toBe(7);
    expect(html).toContain('data-slot="chart-legend"');
    expect(html).toContain("Weekends muted");
    expect(html).not.toContain("Today");
  });

  it("mini table: contact name, duration · language, outcome pill, local time, and a link to the call", () => {
    const html = render();
    expect(html).toContain("Ana Reyes");
    expect(html).toContain("2:12 · ES");
    expect(html).toContain("Booked");
    expect(html).toContain("/dashboard/accounts/acct1/calls/c1");
  });

  it("falls back to the E.164 number when there is no linked contact", () => {
    const html = render({ recentCalls: [{ ...CALL, contact_id: null, contact: null }] });
    expect(html).toContain("+19565061545");
  });

  it("falls back to the E.164 number for a LINKED contact with no name — a real row shape (calls/format.ts's callerLabel doc comment: a call can create a contact from nothing but a spoken email address), and 'contactDisplayName's own (no name) fallback must not win here", () => {
    const html = render({
      recentCalls: [{ ...CALL, contact: { first_name: null, last_name: null } }],
    });
    expect(html).toContain("+19565061545");
    expect(html).not.toContain("(no name)");
  });

  it("stamps the mini table's time in the ACCOUNT zone, not the machine's", () => {
    // Same instant/expectations calls-table.test.ts already independently
    // verified for this exact fixture — reused rather than re-derived.
    expect(render({ timezone: "America/Chicago" })).toContain("2:15");
    expect(render({ timezone: "Asia/Tokyo" })).toContain("4:15");
  });

  it("empty state: zero calls in the window replaces the chart and the table", () => {
    const html = render({ dayBuckets: ZERO_BUCKETS, recentCalls: [] });
    expect(html).toContain("When Sofía answers, every call lands here with its outcome.");
    expect(html).not.toContain("Aug 18 ·");
    expect(html).not.toContain("Ana Reyes");
  });

  it("empty state offers the Voice page only to the agency, when there's no enabled profile", () => {
    const html = render({ dayBuckets: ZERO_BUCKETS, recentCalls: [], isAgency: true, voiceEnabled: false });
    expect(html).toContain("/dashboard/accounts/acct1/voice");
  });

  it("empty state sends a CLIENT viewer to Calls, never the agency-only Voice page", () => {
    const html = render({ dayBuckets: ZERO_BUCKETS, recentCalls: [], isAgency: false, voiceEnabled: false });
    expect(html).toContain("/dashboard/accounts/acct1/calls");
    expect(html).not.toContain("/dashboard/accounts/acct1/voice");
  });

  it("empty state sends the agency to Calls too, once a profile is enabled and the window is just quiet", () => {
    const html = render({ dayBuckets: ZERO_BUCKETS, recentCalls: [], isAgency: true, voiceEnabled: true });
    expect(html).toContain("/dashboard/accounts/acct1/calls");
    expect(html).not.toContain("/dashboard/accounts/acct1/voice");
  });

  it("a quiet 14-day window with real OLDER history shows the empty-state copy AND the mini table — recentCalls is the 3 most recent ever, not scoped to the window", () => {
    const html = render({ dayBuckets: ZERO_BUCKETS, recentCalls: [CALL] });
    expect(html).toContain("When Sofía answers, every call lands here with its outcome.");
    expect(html).toContain("Ana Reyes");
    expect(html).toContain("/dashboard/accounts/acct1/calls/c1");
  });
});
