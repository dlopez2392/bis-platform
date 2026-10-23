import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BusinessHoursCard, clearPlan, defaultHoursWeek, hoursErrorVisible, hoursFromCalendarCopy, seedSpanTime,
} from "./business-hours-card";
import { formFromHours } from "@/lib/voice/knowledge/validate";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { ActionResult } from "./actions";

const noopAction = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));

function render(over: Partial<Parameters<typeof BusinessHoursCard>[0]> = {}) {
  const props = {
    locale: "en" as const, pseudo: false, persona: "Sofía", timezone: "America/Chicago",
    storedHours: null, calendar: { ok: true as const, hours: null }, action: noopAction,
    ...over,
  };
  return renderToStaticMarkup(createElement(BusinessHoursCard, props));
}

describe("seedSpanTime — what a primary-button press on a time field writes (final review I2)", () => {
  const week = () => formFromHours({ mon: [["09:00", "17:00"]] }).map((d) => (d.day === "tue" ? { ...d, open: true, spans: [{ from: "", to: "" }] } : d));

  it("a blank side is seeded in STATE with the calendar's default, opening 08:00 and closing 18:00 (mutation: seed the DOM only, state unchanged -> FAILS)", () => {
    const next = seedSpanTime(week(), "tue", 0, "from");
    expect(next.find((d) => d.day === "tue")!.spans).toEqual([{ from: "08:00", to: "" }]);
    const both = seedSpanTime(next, "tue", 0, "to");
    expect(both.find((d) => d.day === "tue")!.spans).toEqual([{ from: "08:00", to: "18:00" }]);
  });

  it("a side that already holds a time is never overwritten, and the week is returned as is (mutation: always write the default -> FAILS)", () => {
    const days = week();
    expect(seedSpanTime(days, "mon", 0, "from")).toBe(days);
    expect(seedSpanTime(days, "mon", 0, "to")).toBe(days);
    expect(days.find((d) => d.day === "mon")!.spans).toEqual([{ from: "09:00", to: "17:00" }]);
  });
});

describe("the time fields seed on pointerdown through state, never on focus and never by writing the DOM", () => {
  // Comments out first, so this note and the file's own doc comments cannot satisfy or break it.
  const code = readFileSync(join(__dirname, "business-hours-card.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1");

  it("calls seedSpanTime from exactly the two pointerdown handlers, and never seedTimeOnPickerOpen or onFocus (mutation: restore the DOM write -> FAILS)", () => {
    expect((code.match(/seedTimeOnPickerOpen\s*\(/g) ?? []).length).toBe(0);
    expect((code.match(/onFocus\s*=/g) ?? []).length).toBe(0);
    expect((code.match(/onPointerDown\s*=/g) ?? []).length).toBe(2);
    expect((code.match(/seedSpanTime\s*\(/g) ?? []).length).toBe(3); // the definition and the two handlers
  });
});

describe("clearPlan — what Clear hours does (design review I4)", () => {
  it("with hours stored, it posts and its Undo re-saves the STORED week, never the edits on screen (mutation: undo with the on-screen days -> FAILS)", () => {
    expect(clearPlan({ wed: [["10:00", "24:00"]] })).toEqual({
      post: true,
      undoDays: [
        { day: "mon", open: false, spans: [] }, { day: "tue", open: false, spans: [] },
        { day: "wed", open: true, spans: [{ from: "10:00", to: "00:00" }] },
        { day: "thu", open: false, spans: [] }, { day: "fri", open: false, spans: [] },
        { day: "sat", open: false, spans: [] }, { day: "sun", open: false, spans: [] },
      ],
    });
  });

  it("with nothing stored, it posts nothing: the card goes back to its empty state with no toast (mutation: always post -> FAILS)", () => {
    expect(clearPlan(null)).toEqual({ post: false });
  });
});

describe("hoursErrorVisible — the validation sentence waits for a typed time or a save attempt", () => {
  const invalid = { ok: false as const, error: { code: "noDay" as const } };
  it("hidden while nothing was typed and Save was not pressed; shown after either (mutation: show whenever invalid -> FAILS)", () => {
    expect(hoursErrorVisible(invalid, { typed: false, attempted: false })).toBe(false);
    expect(hoursErrorVisible(invalid, { typed: true, attempted: false })).toBe(true);
    expect(hoursErrorVisible(invalid, { typed: false, attempted: true })).toBe(true);
  });
  it("never shown for a valid week", () => {
    expect(hoursErrorVisible({ ok: true, hours: { mon: [["08:00", "18:00"]] } }, { typed: true, attempted: true })).toBe(false);
  });
});

describe("BusinessHoursCard — the fix round's markup", () => {
  it("each span group wraps at a narrow width and is marked for the e2e measure (design review I1; mutation: drop flex-wrap -> FAILS)", () => {
    const html = render({ storedHours: { mon: [["09:00", "12:00"], ["13:00", "17:00"]] } });
    const groups = [...html.matchAll(/<div[^>]*data-hours-span=""[^>]*>/g)].map((g) => g[0]);
    expect(groups.length).toBe(2);
    for (const g of groups) expect(g).toMatch(/class="[^"]*\bflex-wrap\b/);
  });

  it("the time fields, the Open box and the span buttons name their day (mutation: label them 'Opens' alone -> FAILS)", () => {
    const html = render({ storedHours: { mon: [["09:00", "17:00"]] } });
    const text = renderedText(html);
    expect(text).toContain("Opens on Monday");
    expect(text).toContain("Closes on Monday");
    expect(html).toContain('aria-label="Open on Monday"');
    expect(html).toContain('aria-label="Remove these hours on Monday"');
    expect(html).toContain('aria-label="Add another time on Monday"');
    expect(text).toContain(m["voice.hours.addSpan"]);
    // The visible word between the two fields is "to", not "Closes".
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>to<\/span>/);
  });

  it("no zone line when the account has no zone (mutation: always render it -> FAILS)", () => {
    const html = render({ storedHours: { mon: [["09:00", "17:00"]] }, timezone: null });
    expect(renderedText(html)).not.toContain(m["voice.hours.zone"].replace(" {zone}.", ""));
  });

  it("a FAILED calendar read disables Copy with its own sentence, never 'no hours' (mutation: treat a failure as no hours -> FAILS)", () => {
    const html = render({ storedHours: null, calendar: { ok: false } });
    const text = renderedText(html);
    expect(text).toContain(m["voice.hours.copyFromCalendarFailed"]);
    expect(text).not.toContain(m["voice.hours.copyFromCalendarNone"]);
    const copy = [...html.matchAll(new RegExp(`<button\\b[^>]*>\\s*${m["voice.hours.copyFromCalendar"]}\\s*</button>`, "g"))];
    expect(copy.length).toBe(1);
    expect(/ disabled=""/.test(copy[0]![0])).toBe(true);
  });

  // A stored overlap (only a hand edit could make one) is an INVALID first render: the one way to see the
  // invalid face without a click.
  it("an invalid week renders Save enabled and no sentence yet: it is explained on the attempt (mutation: disabled={!validation.ok}, or show whenever invalid -> FAILS)", () => {
    const html = render({ storedHours: { mon: [["09:00", "13:00"], ["12:00", "17:00"]] } });
    const save = [...html.matchAll(new RegExp(`<button\\b[^>]*>\\s*${m["voice.hours.save"]}\\s*</button>`, "g"))];
    expect(save.length).toBe(1);
    expect(/ disabled=""/.test(save[0]![0])).toBe(false);
    expect(renderedText(html)).not.toContain(m["voice.hours.error.overlap"].replace("{day}", "Monday"));
  });
});

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
    const html = render({ storedHours: { mon: [["09:00", "17:00"]] }, calendar: { ok: true, hours: {} } });
    const text = renderedText(html);
    const copyButtons = [...html.matchAll(new RegExp(`<button\\b[^>]*>\\s*${m["voice.hours.copyFromCalendar"]}\\s*</button>`, "g"))];
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(copyButtons.every((b) => / disabled=""/.test(b[0]))).toBe(true);
    expect(text).toContain(m["voice.hours.copyFromCalendarNone"]);
  });

  it("does not disable the Copy button when the calendar has usable hours", () => {
    const html = render({ storedHours: { mon: [["09:00", "17:00"]] }, calendar: { ok: true, hours: { tue: [["08:00", "18:00"]] } } });
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
    const html = render({ storedHours: null, calendar: { ok: true, hours: null } });
    const copyButtons = [...html.matchAll(new RegExp(`<button\\b[^>]*>\\s*${m["voice.hours.copyFromCalendar"]}\\s*</button>`, "g"))];
    expect(copyButtons.length).toBe(1);
    expect(/ disabled=""/.test(copyButtons[0]![0])).toBe(true);
  });
});
