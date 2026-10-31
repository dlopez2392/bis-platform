import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarRow } from "@bis/db";
import { CalendarSettings } from "./calendar-settings";

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

function render(over: Partial<CalendarRow> = {}): string {
  return renderToStaticMarkup(createElement(CalendarSettings, {
    isAgency: true,
    calendar: { ...BASE_CALENDAR, ...over },
    action: async () => ({ ok: true as const }),
  }));
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

describe("CalendarSettings — the setup step's anchor (F-046 part 1)", () => {
  // The setup wizard's hours link lands on `#booking-settings` (step-shared.tsx's STEP_PATH): the agenda card
  // now comes first on the page, so a bare `/calendar` would leave the owner above the card they came for.
  it("the outer card carries id=\"booking-settings\", exactly once (mutation: drop the id → FAILS)", () => {
    const html = render();
    expect(html).toMatch(/^<div [^>]* id="booking-settings"/);
    expect(html.match(/id="booking-settings"/g)).toHaveLength(1);
  });
});
