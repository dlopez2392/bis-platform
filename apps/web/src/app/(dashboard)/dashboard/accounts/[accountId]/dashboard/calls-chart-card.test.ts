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
  duration_secs: 132,
  outcome: "booked",
  language: "es",
  caller_e164: "+19565061545",
  contact_id: "ct1",
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

/** The class list immediately BEFORE a marker string in the rendered HTML —
 *  each bar's colored `<div>` (carrying `bg-primary`/`bg-muted`) is emitted
 *  ahead of its tooltip text in DOM order, so this proves which treatment a
 *  SPECIFIC day's bar actually got, not just that both classes appear
 *  somewhere in the document. */
function htmlBefore(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  expect(idx, `expected to find "${marker}" in the rendered HTML`).toBeGreaterThan(-1);
  return html.slice(Math.max(0, idx - 400), idx);
}

describe("CallsChartCard", () => {
  it("gives every one of the 14 bars a visible tooltip and an sr-only twin", () => {
    const html = render();
    expect(html).toContain("Aug 18 · 5 calls");
    expect(html).toContain("Aug 31 · 13 calls");
    expect(html).toContain("August 18, 5 calls");
    expect(html).toContain("August 31, 13 calls");
  });

  it("weekday bars carry the accent (bg-primary); weekend bars are muted (bg-muted)", () => {
    const html = render();
    const weekday = htmlBefore(html, "Aug 18 · 5 calls");
    expect(weekday).toContain("bg-primary");
    expect(weekday).not.toContain("bg-muted");

    const weekend = htmlBefore(html, "Aug 23 · 3 calls");
    expect(weekend).toContain("bg-muted");
    expect(weekend).not.toContain("bg-primary");
  });

  it("axis: the window's start date, the weekends-muted caption, and today", () => {
    const html = render();
    expect(html).toContain("Aug 18");
    expect(html).toContain("Weekends muted");
    expect(html).toContain("Today");
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
