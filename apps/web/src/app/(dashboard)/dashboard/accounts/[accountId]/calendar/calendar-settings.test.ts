import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarRow } from "@bis/db";
import { LocaleProvider } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { CalendarSettings, unitLabel } from "./calendar-settings";

/**
 * Task 17 review round 1 (Important 2): no render test existed for this
 * card at all. `CalendarSettings` is "use client" (useState), so — same
 * device as `bookings-list.test.ts` and `voice-settings.test.ts` —
 * `renderToStaticMarkup` + `createElement` directly; it has no hooks that
 * require an actual DOM.
 */

const BASE_CALENDAR: CalendarRow = {
  id: "cal_1", account_id: "a1", public_id: "pub_1", enabled: true,
  slot_duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 1, max_advance_days: 30,
  open_hours: {}, notify_emails: [], meeting_type: "in_person",
  followup_enabled: true, followup_body: "Custom English follow-up.",
  followup_body_es: null, followup_body_es_basis: null,
};

// S-10 review I-2: the page (page.tsx:112-113) resolves `locale`/`pseudo` once and hands them to every
// card as PROPS (ClosedDaysCard, FeedCard, JobDrawer) — never through the ambient LocaleProvider, which
// is blind to `?locale=es`/`?locale=pseudo` (the QA override reaches the page's own resolver, not the
// layout's). This card takes the same two props now.
function render(over: Partial<CalendarRow> = {}, locale: Locale = "en", pseudo = false): string {
  return renderToStaticMarkup(
    createElement(CalendarSettings, {
      isAgency: true,
      calendar: { ...BASE_CALENDAR, ...over },
      action: async () => ({ ok: true as const }),
      locale,
      pseudo,
    }),
  );
}

describe("CalendarSettings — the follow-up card's Spanish box (Task 17)", () => {
  it("renders the Spanish box beside the English follow-up box (mutation: drop the field → FAILS)", () => {
    expect(render()).toContain('name="body_es"');
  });

  /**
   * DESIGN.md rule 8: the card is one view, one primary Save; the Spanish
   * box's own "Use our Spanish" button (shown here because the box reads as
   * emptied — stored `''`, our Spanish default is non-empty) is a `ghost`
   * button (`data-variant` other than `"default"`), never a second primary.
   * Probe (coordinator, review round 1): swap `SpanishBodyField`'s ghost
   * "Use our Spanish" button to the primary variant → a second
   * `data-variant="default"` appears → this reds BY NAME.
   */
  it("the card still has exactly ONE primary Save button, even with the Spanish box emptied and its ghost 'Use our Spanish' button showing (rule 8; mutation: a second data-variant=\"default\" → FAILS)", () => {
    const html = render({ followup_body_es: "", followup_body_es_basis: null });
    expect(html).toContain("Use our Spanish");
    const matches = html.match(/data-variant="default"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("the card has exactly ONE primary Save button in the ordinary (non-emptied) case too", () => {
    const html = render();
    const matches = html.match(/data-variant="default"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("CalendarSettings — Spanish (S-10 T4)", () => {
  it("renders the card's title, hours label and day names in Spanish (mutation: render English under es -> FAILS)", () => {
    const html = render({}, "es");
    expect(html).toContain("Ajustes de citas");
    expect(html).toContain("Horario");
    expect(html).toContain("Lunes");
    expect(html).not.toContain("Booking settings");
    expect(html).not.toContain(">Monday<");
  });

  // S-10 review I-2: takes `locale` as its OWN prop, never the ambient LocaleProvider (which the
  // layout seeds once and which is blind to `?locale=`). Wrapping in a LocaleProvider with a
  // DIFFERENT locale than the prop proves which one wins: reading useLocale() instead would render
  // the context's "en" ("Booking settings"), not the prop's "es".
  it("takes its locale from its own prop, never the ambient LocaleProvider (mutation: read useLocale() instead of the prop -> FAILS)", () => {
    const html = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>, createElement(CalendarSettings, {
        isAgency: true, calendar: BASE_CALENDAR, action: async () => ({ ok: true as const }), locale: "es", pseudo: false,
      })),
    );
    expect(html).toContain("Ajustes de citas");
    expect(html).not.toContain("Booking settings");
  });

  it("pads with the pseudo-locale when its pseudo prop is on, the same way every other card on this page does (mutation: ignore the pseudo prop -> FAILS; S-10 review I-2)", () => {
    const html = render({}, "en", true);
    expect(html).toContain(pseudoLocale(t(m, "calendar.settings.title", "en")));
    expect(html).not.toContain(">Booking settings<");
  });
});

// S-10 review M-4: the duration/buffer/notice/advance Selects' unit suffix, pulled into a pure
// function so it is directly testable — Radix's SelectContent renders through a portal that
// `renderToStaticMarkup` never mounts (confirmed empirically: the hidden native <select> fallback
// ships with no <option> children either), so a render test could never see "30 min" in the markup.
describe("unitLabel (S-10 review M-4)", () => {
  it("formats minutes, hours and days in English and Spanish (mutation: hard-code the English suffix -> FAILS)", () => {
    expect(unitLabel(30, "min", "en")).toBe("30 min");
    expect(unitLabel(30, "min", "es")).toBe("30 min");
    expect(unitLabel(24, "hr", "en")).toBe("24 hr");
    expect(unitLabel(24, "hr", "es")).toBe("24 h");
    expect(unitLabel(7, "days", "en")).toBe("7 days");
    expect(unitLabel(7, "days", "es")).toBe("7 días");
  });
});

describe("CalendarSettings — the setup step's anchor (F-046 part 1)", () => {
  // The setup wizard's hours link lands on `#booking-settings` (step-shared.tsx's STEP_PATH): the agenda card
  // now comes first on the page, so a bare `/calendar` would leave the owner above the card they came for.
  it("the outer card carries id=\"booking-settings\", exactly once (mutation: drop the id → FAILS)", () => {
    const html = render();
    expect(html).toMatch(/^<div [^>]* id="booking-settings"/);
    expect(html.match(/id="booking-settings"/g)).toHaveLength(1);
  });
});
