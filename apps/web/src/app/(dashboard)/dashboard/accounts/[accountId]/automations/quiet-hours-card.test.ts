import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import { QuietHoursCard } from "./quiet-hours-card";

const render = (zoneLabel: string) => renderToStaticMarkup(createElement(QuietHoursCard, { zoneLabel }));

/**
 * The sending hours are FIXED (consent chain spec decision 4), so the card
 * that used to hold a form now states them, read-only (spec §6).
 */
describe("QuietHoursCard — the fixed hours, said once, never a setting", () => {
  it("states the spec's sentence with the account's own zone (mutation: drop the zone replace → '{zone}' shows, FAILS)", () => {
    const text = renderedText(render("America/Chicago"));
    expect(text).toContain(m["automations.quiet.fixed"].replace("{zone}", "America/Chicago"));
    expect(text).not.toContain("{zone}");
  });

  it("names the zone it was given, not a default (mutation: hardcode America/Chicago → FAILS)", () => {
    expect(renderedText(render("America/Los_Angeles"))).toContain("(America/Los_Angeles)");
  });

  it("has no form, no input and no button: nothing to switch off (mutation: leave the old Save form in → FAILS)", () => {
    const html = render("America/Chicago");
    expect(html).not.toMatch(/<form\b|<input\b|<button\b/);
  });

  it("keeps the #quiet-hours anchor and its test id", () => {
    const html = render("America/Chicago");
    expect(html).toContain('id="quiet-hours"');
    expect(html).toContain('data-testid="quiet-hours-card"');
  });
});
