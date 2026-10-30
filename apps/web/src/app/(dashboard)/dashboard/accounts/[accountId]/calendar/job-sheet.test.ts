import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * F-046 part 1, T11/T12 review and the design review: what the Add job form and the job drawer DRAW, server
 * rendered from fixed props (the handlers' behaviour is job-sheet-handlers.test.ts's and
 * job-drawer-handlers.test.ts's). Move offers saved addresses only; a nameless phone owner reads a plain word;
 * the pseudo-locale reaches the sheet and the drawer; the drawer's details sit under a mono section label.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const { JobForm } = await import("./job-sheet");
const { JobDrawerDetails, JobDrawerHeader } = await import("./job-drawer");
const { m } = await import("@/lib/messages");
const { t } = await import("@/lib/i18n/t");
const { pseudoLocale } = await import("@/lib/i18n/pseudo-locale");
const { renderedText } = await import("@/lib/rendered-text");
type FormProps = Parameters<typeof JobForm>[0];
type DrawerView = Parameters<typeof JobDrawerDetails>[0]["view"];

const noop = () => {};
const OPENED = { startsAt: "2026-11-03T16:00:00.000Z", endsAt: "2026-11-03T17:00:00.000Z", note: "Leak", placeId: "p1", meetingType: null, meetingUrl: null };
const form = (over: Partial<FormProps> = {}) => renderToStaticMarkup(createElement(JobForm, {
  accountId: "a1", timezone: "America/Chicago", locale: "en", mode: "add", calendarMeetingType: "in_person", defaultMinutes: 60,
  prefill: { date: "2026-11-03", start: "10:00", minutes: 60, meetingType: "in_person" }, onDone: noop, onCancel: noop, ...over,
}));
const VIEW: DrawerView = {
  id: "b1", customer: { id: "c1", name: "Ana García", first: "Ana", phone: "(956) 555-0100", email: null },
  when: "Tue, Nov 3, 10:00 AM", lengthMinutes: 60, what: "Leak", address: "1 Elm", meetingType: "in_person", meetingUrl: null,
  status: "booked", statusWord: "Booked", madeBy: "Added by you", madeAt: "Nov 1, 9:42 AM", confirmReply: "yes",
  email: { state: "pending", kind: "confirmation", at: null }, holdOpen: false, isMove: false, started: false, canWrite: true, canCloseOut: true,
  opened: OPENED, told: true, recordHref: "#",
};

describe("Move offers saved addresses only (T11/T12 review: Move threw away a typed New address)", () => {
  it("Add offers New address; Move does not (mutation: offer it in Move -> FAILS)", () => {
    expect(form()).toMatch(/<option value="new"/);
    const move = form({
      mode: "move", job: { id: "b1", opened: { ...OPENED, told: true } },
      prefill: { date: "2026-11-03", start: "10:00", minutes: 60, meetingType: "in_person", placeId: "p1", customer: { id: "c1", name: "Ana García", first: "Ana" } },
    });
    expect(move).toContain('data-job-form="move"');
    expect(move).not.toMatch(/<option value="new"/);
    expect(renderedText(move)).not.toContain(m["calendar.job.newAddress"]);
  });
});

describe("the phone owner's offer with no name on the owner (T11/T12 review minor)", () => {
  it("reads a plain word, never 'already has this number. Use ?' (mutation: the raw name -> FAILS)", () => {
    const text = renderedText(form({ specimen: { phoneOwner: { id: "x", name: "", first: "" }, typed: { name: "Ana Reyes", phone: "956" } } }));
    expect(text).toContain(t(m, "calendar.job.phoneOwner", "en", { name: m["places.thisCustomer"], first: "this customer" }));
    expect(text).toContain(t(m, "calendar.job.useExisting", "en", { first: "this customer" }));
    expect(text).not.toContain("Use ?");
  });
});

describe("the pseudo-locale reaches the sheet and the drawer (design review C1)", () => {
  it("the sheet's words are padded (mutation: raw t() in the form -> FAILS)", () => {
    const text = renderedText(form({ pseudo: true }));
    expect(text).toContain(pseudoLocale(m["calendar.job.customer"]));
    expect(text).toContain(pseudoLocale(m["calendar.job.save"]));
    expect(text).not.toContain(m["calendar.job.meet"]);
    const warned = renderedText(form({ pseudo: true, specimen: { warnings: [{ key: "outside_hours", kind: "outside_hours" }] } }));
    expect(warned).toContain(pseudoLocale(m["calendar.job.warn.outsideHours"]));
  });

  it("the drawer's words are padded, its header's too (mutation: raw t() in the drawer -> FAILS)", () => {
    const details = renderedText(renderToStaticMarkup(createElement(JobDrawerDetails, {
      view: VIEW, timezone: "America/Chicago", locale: "en", pseudo: true, onMove: noop, onCancel: noop, onCloseOut: noop,
    })));
    for (const k of ["calendar.job.titleMove", "calendar.job.openRecord", "calendar.job.emailPending", "calendar.job.inPerson"] as const) {
      expect(details, k).toContain(pseudoLocale(m[k]));
    }
    const header = renderedText(renderToStaticMarkup(createElement(JobDrawerHeader, { view: VIEW, locale: "en", pseudo: true })));
    expect(header).toContain(pseudoLocale(m["calendar.bookings.confirmed"]));
  });
});

describe("the drawer's details sit under a mono section label (design review M3)", () => {
  it("a Details label in the Label role heads the details (mutation: drop it -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(JobDrawerDetails, {
      view: VIEW, timezone: "America/Chicago", locale: "es", onMove: noop, onCancel: noop, onCloseOut: noop,
    }));
    const label = /<h3 class="([^"]*)"[^>]*>([^<]*)<\/h3>\s*<dl/.exec(html);
    expect(label?.[2]).toBe(m["groupPage.card.details.es"]);
    expect(label?.[1]).toMatch(/font-mono/);
    expect(label?.[1]).toMatch(/text-\[10px\]/);
    expect(label?.[1]).toMatch(/uppercase/);
  });
});
