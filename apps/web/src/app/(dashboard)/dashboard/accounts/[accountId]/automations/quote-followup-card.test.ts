import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  QUOTE_FOLLOWUP_MIN_QUIET_DAYS, QUOTE_FOLLOWUP_MAX_QUIET_DAYS, QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS,
  type AutomationRow,
} from "@bis/db";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";
import { defaultQuoteFollowupBody } from "@/lib/automations/quote-followup-copy";

// Imported at module scope by the card; never called during a server render.
vi.mock("sonner", () => ({ toast: {} }));

import { QuoteFollowupCard } from "./quote-followup-card";

/**
 * Three things this card has to get right that no other test can see.
 *
 * 1. THE NUMBER BOX IS BUILT FROM THE CONSTANTS. The assertions below are
 *    built from the SAME constants, which is deliberate and not vacuous: the
 *    failure this catches is a HARD-CODED literal in the card, and a
 *    hard-coded `max={21}` reds the max assertion immediately.
 * 2. THE VANISHED-STAGE NOTICE. A normal tick cannot log a stage that no
 *    longer exists (the due-list filters on `stage_id`, so there is no row
 *    and no subject to write against), which makes this card the ONLY place
 *    an operator can be told. Both directions are asserted: a one-sided case
 *    would pass against a notice that always renders.
 * 3. THE SEGMENT COUNTER COUNTS THE DISCLOSED BODY, because
 *    `sendAutomationSms` appends the opt-out sentence unconditionally.
 */
const STAGE_ID = "6f1b2c3d-4e5a-4b7c-8d9e-0a1b2c3d4e5f";
const STAGES = [{ id: STAGE_ID, label: "Quoted" }, { id: "stg_b", label: "Won" }];

const ROW: AutomationRow = {
  id: "au8", account_id: "a1", recipe_key: "quote_followup", enabled: true,
  body: "", config: { stageId: STAGE_ID, quietDays: 4, channel: "sms" },
  created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

function render(over: Partial<Parameters<typeof QuoteFollowupCard>[0]> = {}): string {
  return renderToStaticMarkup(createElement(QuoteFollowupCard, {
    automation: ROW, brandName: "Rio Roofing", smsGate: { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    stages: STAGES,
    saveAction: async () => ({ ok: true as const }),
    ...over,
  }));
}

describe("the quote follow-up card", () => {
  it("says out loud that nothing puts a deal in the pipeline on its own", () => {
    // The recipe's honest caveat: the pipeline dialog, the demo seed and an
    // accepted call proposal are the only three writers of an opportunity, so
    // an operator who expects deals to appear would wait for ever. Mutation:
    // delete the clause from `automations.quoteFollowup.body` → this reds.
    const html = render();
    expect(html).toContain(m["automations.quoteFollowup.body"]);
    expect(m["automations.quoteFollowup.body"].toLowerCase()).toContain("nothing happens on its own");
  });

  /**
   * THE PLAN ASKED FOR "the stage select lists the account's stages" AND A
   * STATIC RENDER CANNOT SEE THAT. Radix's `SelectContent` mounts its items
   * in a portal only while the menu is OPEN, and its hidden native mirror
   * renders as a bare `<select name="stage_id"></select>` under
   * `renderToStaticMarkup` — asserting `toContain("Quoted")` passes only by
   * accident of some other string and reds nothing real. The option list is
   * Playwright's (Task 11). What IS assertable here, and what this case
   * therefore asserts, is that the SELECT EXISTS AND IS NAMED when the
   * account has stages and is replaced by prose when it has none: the
   * control the action reads `stage_id` off, present or absent for the right
   * reason.
   */
  it("renders a named stage control when the account has stages, and prose instead when it has none", () => {
    expect(render()).toContain('name="stage_id"');
    const none = render({ stages: [] });
    expect(none).not.toContain('name="stage_id"');
    expect(none).toContain('data-testid="quote-followup-no-stages"');
  });

  it("warns when the stored stage is GONE, and stays quiet when it is present", () => {
    // Mutation: render the notice unconditionally → the second half reds;
    // delete the `stageMissing` branch → the first half reds. A one-sided
    // assertion here would pass against a notice that always renders.
    const missing = render({
      automation: { ...ROW, config: { stageId: "11111111-2222-4333-8444-555555555555", quietDays: 4, channel: "sms" } },
    });
    expect(missing).toContain(m["automations.quoteFollowup.stageMissing"]);
    expect(render()).not.toContain(m["automations.quoteFollowup.stageMissing"]);
  });

  it("with no pipeline stages at all it says so and the save button is disabled", () => {
    // Mutation: drop the `disabled={!hasStages}` → the disabled assertion
    // reds, and an operator could save a recipe that can never match a row.
    const html = render({ stages: [] });
    expect(html).toContain(m["automations.quoteFollowup.noStages"]);
    // THE SUBMIT BUTTON specifically, not `[^>]*disabled[^>]*`: every control
    // in this card carries `disabled:cursor-not-allowed` in its class list, so
    // a loose regex matches the checkbox and passes with the guard deleted.
    expect(html).toContain(String.raw`type="submit" disabled=""`);
    // …and with stages the button is live.
    expect(render()).not.toContain(String.raw`type="submit" disabled=""`);
  });

  it("builds the day box from the CONSTANTS, never a literal", () => {
    const html = render({ automation: null });
    expect(html).toContain(`min="${QUOTE_FOLLOWUP_MIN_QUIET_DAYS}"`);
    expect(html).toContain(`max="${QUOTE_FOLLOWUP_MAX_QUIET_DAYS}"`);
    // An unconfigured account gets the platform default in the box.
    expect(html).toContain(`value="${QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS}"`);
    // …and a configured one gets its own stored number, not the default.
    expect(render()).toContain('value="4"');
  });

  it("counts the DISCLOSED body, the one the carrier bills", () => {
    // `sendAutomationSms` appends " Reply STOP to opt out." unconditionally
    // (send-sms.ts:82). Mutation: count the undisclosed body → the segment
    // count drops and this reds by name. The brand name here is chosen so the
    // two differ (the guard below proves it), and it is an accented Valley
    // name because half this client base has one.
    const body = defaultQuoteFollowupBody("García Roofing");
    const disclosed = segmentsFor(withOptOut(body));
    const undisclosed = segmentsFor(body);
    expect(disclosed.segments).not.toBe(undisclosed.segments);   // guards the fixture
    const line = (x: { chars: number; segments: number }) => m["compose.smsSegments"]
      .replace("{chars}", String(x.chars)).replace("{segments}", String(x.segments));
    const html = render({ brandName: "García Roofing" });
    expect(html).toContain(line(disclosed));
    expect(html).not.toContain(line(undisclosed));
  });

  it("shows no segment counter at all on the email channel", () => {
    const html = render({
      automation: { ...ROW, config: { stageId: STAGE_ID, quietDays: 4, channel: "email" } },
    });
    expect(html).not.toContain('data-testid="quote-followup-sms-count"');
  });
});
