import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QuietSettings } from "@bis/db";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import { QuietHoursCard } from "./quiet-hours-card";
import type { ActionResult } from "./actions";

const SETTINGS: QuietSettings = { enabled: true, start: "22:30", end: "06:15" };
const saveAction = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));

function render(settings: QuietSettings | null) {
  return renderToStaticMarkup(
    createElement(QuietHoursCard, { settings, zoneLabel: "America/Chicago", saveAction }),
  );
}

// Anchored on `type="submit"`, the one submit button on this card, with a
// leading space before `disabled=""` so the lookahead cannot match inside a
// neighbouring `data-disabled=""` attribute (voice-settings.test.ts's own
// precedent for a Radix/shadcn control's attribute-order independence).
const DISABLED_SAVE_BUTTON = /<button\b(?=[^>]*\btype="submit")(?=[^>]* disabled="")[^>]*>/;

/**
 * Branch-fix wave item 3: a `null` `settings` means the page's own read
 * failed. Rendering `DEFAULT_QUIET_SETTINGS` as though they were the saved
 * window and leaving the form live would let an agency press Save and
 * silently overwrite a client's real 22:30–06:15 with the platform default
 * (9:00 PM–8:00 AM) — so the null case gets a Notice and a form nobody can
 * submit, instead.
 */
describe("QuietHoursCard — a degraded read must not look editable or saved", () => {
  it("a normal read shows no notice and a live, submittable form", () => {
    // Mutation: force `readFailed` to `true` unconditionally → FAILS (the
    // notice appears and the Save button carries `disabled=""` even here).
    const html = render(SETTINGS);
    const text = renderedText(html);
    expect(text).not.toContain(m["automations.quiet.readFailed"]);
    expect(html).not.toMatch(DISABLED_SAVE_BUTTON);
  });

  it("a failed read (settings: null) shows the crit notice and disables the Save button", () => {
    // Mutation: drop the `disabled={readFailed}` prop from SubmitButton →
    // FAILS (the notice still renders, but the button is submittable).
    const html = render(null);
    const text = renderedText(html);
    expect(text).toContain(m["automations.quiet.readFailed"]);
    expect(html).toMatch(DISABLED_SAVE_BUTTON);
  });
});
