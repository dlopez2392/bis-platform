import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessHoursCard, defaultHoursWeek, hoursFromCalendarCopy } from "./business-hours-card";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { ActionResult } from "./actions";

const noopAction = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));

function render(over: Partial<Parameters<typeof BusinessHoursCard>[0]> = {}) {
  const props = {
    locale: "en" as const, pseudo: false, persona: "Sofía", timezone: "America/Chicago",
    storedHours: null, calendarHours: null, action: noopAction,
    ...over,
  };
  return renderToStaticMarkup(createElement(BusinessHoursCard, props));
}

describe("hoursFromCalendarCopy — the pure fill behind 'Copy from calendar'", () => {
  it("fills Monday-first rows from the calendar's usable hours, without touching any action (mutation: return null even when usable -> FAILS)", () => {
    const result = hoursFromCalendarCopy({ mon: [["09:00", "17:00"]] });
    expect(result).not.toBeNull();
    expect(result!.find((d) => d.day === "mon")).toEqual({ day: "mon", open: true, spans: [{ from: "09:00", to: "17:00" }] });
    expect(result!.find((d) => d.day === "tue")).toEqual({ day: "tue", open: false, spans: [] });
  });

  // MUTATION: drop the `usableHours` gate and return `formFromHours(calendarHours)` unconditionally
  // -> this FAILS, because an empty/no-open-day calendar would stop disabling the button.
  it("is null when the calendar has no open day, which is the ONLY thing the Copy button's disabled reads", () => {
    expect(hoursFromCalendarCopy({})).toBeNull();
    expect(hoursFromCalendarCopy(null)).toBeNull();
  });
});

describe("defaultHoursWeek — 'Set hours'' starting point", () => {
  it("opens Monday to Friday 08:00-18:00 and leaves Saturday/Sunday closed (mutation: open every day -> FAILS)", () => {
    const week = defaultHoursWeek();
    for (const day of ["mon", "tue", "wed", "thu", "fri"] as const) {
      expect(week.find((d) => d.day === day)).toEqual({ day, open: true, spans: [{ from: "08:00", to: "18:00" }] });
    }
    for (const day of ["sat", "sun"] as const) {
      expect(week.find((d) => d.day === day)).toEqual({ day, open: false, spans: [] });
    }
  });
});

describe("BusinessHoursCard — loaded", () => {
  it("renders the grid, the zone line, and exactly ONE primary Save (rule 8; mutation: a second data-variant=\"default\" -> FAILS)", () => {
    const html = render({ storedHours: { mon: [["09:00", "17:00"]] }, timezone: "America/Chicago" });
    const text = renderedText(html);
    expect(text).toContain(m["voice.hours.title"]);
    expect(text).toContain(m["voice.hours.zone"].replace("{zone}", "America/Chicago"));
    expect(text).toContain(m["voice.hours.day.mon"]);
    expect((html.match(/data-variant="default"/g) ?? []).length).toBe(1);
    expect(text).toContain(m["voice.hours.save"]);
    expect(text).toContain(m["voice.hours.clear"]);
  });

  // A7: the engine's only spelling for "open until midnight" is "24:00", which `<input type="time">`
  // cannot hold — `formFromHours` mirrors it to "00:00" for display (validate.ts), and this proves the
  // card actually renders that mirrored value rather than the raw "24:00".
  it("a stored 24:00 close renders as 00:00 in the time field (A7; mutation: render the raw stored value -> FAILS)", () => {
    const html = render({ storedHours: { mon: [["20:00", "24:00"]] } });
    expect(html).toMatch(/<input[^>]*type="time"[^>]*value="00:00"/);
    expect(html).not.toContain('value="24:00"');
  });

  it("disables the Copy button and shows its hint when the calendar has no open day (mutation: drop the disabled attribute -> FAILS)", () => {
    const html = render({ storedHours: { mon: [["09:00", "17:00"]] }, calendarHours: {} });
    const text = renderedText(html);
    const copyButtons = [...html.matchAll(new RegExp(`<button\\b[^>]*>\\s*${m["voice.hours.copyFromCalendar"]}\\s*</button>`, "g"))];
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(copyButtons.every((b) => / disabled=""/.test(b[0]))).toBe(true);
    expect(text).toContain(m["voice.hours.copyFromCalendarNone"]);
  });

  it("does not disable the Copy button when the calendar has usable hours", () => {
    const html = render({ storedHours: { mon: [["09:00", "17:00"]] }, calendarHours: { tue: [["08:00", "18:00"]] } });
    const copyButtons = [...html.matchAll(new RegExp(`<button\\b[^>]*>\\s*${m["voice.hours.copyFromCalendar"]}\\s*</button>`, "g"))];
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(copyButtons.some((b) => / disabled=""/.test(b[0]))).toBe(false);
    expect(renderedText(html)).not.toContain(m["voice.hours.copyFromCalendarNone"]);
  });

  it("sets lang on the card's root when the locale is Spanish (mutation: drop the lang prop -> FAILS)", () => {
    const html = render({ locale: "es", storedHours: { mon: [["09:00", "17:00"]] } });
    expect(html).toMatch(/<div[^>]*id="business-hours"[^>]*lang="es"/);
    expect(renderedText(html)).toContain(m["voice.hours.title.es"]);
  });
});

describe("BusinessHoursCard — empty", () => {
  it("shows the empty state, sells the two actions, and never shows a primary button (mutation: render the grid anyway -> FAILS)", () => {
    const html = render({ storedHours: null });
    const text = renderedText(html);
    expect(text).toContain(m["voice.hours.empty"].replace("{persona}", "Sofía"));
    expect(text).toContain(m["voice.hours.copyFromCalendar"]);
    expect(text).toContain(m["voice.hours.setHours"]);
    expect((html.match(/data-variant="default"/g) ?? []).length).toBe(0);
  });

  it("the empty state's Copy button is disabled with its hint when the calendar has none either", () => {
    const html = render({ storedHours: null, calendarHours: null });
    const copyButtons = [...html.matchAll(new RegExp(`<button\\b[^>]*>\\s*${m["voice.hours.copyFromCalendar"]}\\s*</button>`, "g"))];
    expect(copyButtons.length).toBe(1);
    expect(/ disabled=""/.test(copyButtons[0]![0])).toBe(true);
  });
});
