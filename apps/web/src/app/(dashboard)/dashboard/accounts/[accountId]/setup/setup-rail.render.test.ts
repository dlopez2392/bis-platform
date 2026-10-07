import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupStepView } from "@/lib/setup/setup-view";
import { renderedText } from "@/lib/rendered-text";
import { SetupRail } from "./setup-rail";

// `SetupRail` uses no hooks (selection state lives in setup-shell.tsx's
// `useSetupStep`, a sibling the rail never calls) — a plain
// `renderToStaticMarkup` pass is enough, same shape as
// steps/website-assistant.test.ts.

function view(key: SetupStepView["key"], over: Partial<SetupStepView> = {}): SetupStepView {
  return { key, done: false, skipped: false, unknown: false, ...over };
}

function render(views: SetupStepView[]): string {
  return renderToStaticMarkup(createElement(SetupRail, {
    views, selected: views[0]!.key, nextKey: null, blockedReason: null, onSelect: () => {},
  }));
}

/** Every rail entry's own marker text — the two-digit number when the entry
 *  has no status icon (an `open` or `next` kind; `done`/`skipped`/`unknown`/
 *  `locked` all render a lucide icon there instead, per setup-rail.tsx's
 *  `ICON` map). Matched by position in the document, which is the entries'
 *  own render order. */
function visibleNumbers(html: string): string[] {
  return [...html.matchAll(/<span aria-hidden="true"[^>]*>(\d{2})<\/span>/g)].map((m) => m[1]!);
}

describe("SetupRail numbering", () => {
  // CRM-only: five steps, none of which lock each other (website_assistant's
  // only prerequisite, voice_profile, is not even in this `views` at all —
  // setup-rail.test.ts's own "never locks website_assistant on a CRM-only
  // plan" pins that separately) and none done by default, so EVERY entry
  // renders its number as plain text — the one fixture where a fully gapless
  // "01..05" is actually visible end to end.
  it("numbers a CRM-only account's five steps 01..05, contiguous — not the full list's 1,2,3,5,7", () => {
    const keys: SetupStepView["key"][] = ["account", "branding", "hours", "website_assistant", "email"];
    const html = render(keys.map((k) => view(k)));
    // MUTATION: revert the rail to `SETUP_STEP_KEYS.map((key, index) => ...)`
    // with `String(index + 1)` — this FAILS, producing ["01", "02", "03",
    // "05", "07"] (website_assistant and email's positions in the FULL ten)
    // instead of a gapless count.
    expect(visibleNumbers(html)).toEqual(["01", "02", "03", "04", "05"]);
    expect(renderedText(html)).toContain("Website assistant");
  });

  // Full plan, all ten steps undone: website_assistant, test_call and
  // go_live are the three LOCKABLE steps (setup-rail.ts's `isLockedStep`),
  // and with nothing done yet, each of their own prerequisites reads unmet —
  // website_assistant locks on voice_profile; test_call locks on
  // number+voice_profile; go_live locks on all five `GO_LIVE_PREREQ_KEYS`.
  // That promotes all three to `railKindOf`'s "locked" kind, which renders a
  // Lock icon (setup-rail.tsx's `ICON` map) instead of the step's number —
  // so those three positions (5th, 9th, 10th) carry NO visible number at
  // all, while the other seven do, each still reading its own gapless
  // position in `views` (`stepNumber`): account=01, branding=02, hours=03,
  // voice_profile=04, (website_assistant locked), number=06, email=07,
  // forwarding=08, (test_call locked), (go_live locked). This is NOT every
  // number 01..10 rendering — it is exactly the seven unlockable steps'
  // numbers, in order, which is the full set this fixture can ever show.
  it("still numbers the full plan's seven unlockable steps 01,02,03,04,06,07,08 in order, and renders all ten titles", () => {
    const keys: SetupStepView["key"][] = [
      "account", "branding", "hours", "voice_profile", "website_assistant", "number",
      "email", "forwarding", "test_call", "go_live",
    ];
    const html = render(keys.map((k) => view(k)));
    const text = renderedText(html);
    for (const title of [
      "Create the account", "Branding", "Business hours", "Voice profile", "Website assistant",
      "Phone number", "Email identity", "Call forwarding", "Test call", "Go live",
    ]) {
      expect(text).toContain(title);
    }
    // MUTATION: in setup-rail.ts's `railKindOf`, drop the `isLockedStep`
    // promotion (`return kind;` unconditionally) -- this FAILS: with no
    // step ever reading `locked`, website_assistant/test_call/go_live fall
    // back to rendering their own numbers too (05, 09, 10), producing all
    // ten "01".."10" instead of the seven-number gapped list below. Indexing
    // into the full `SETUP_STEP_KEYS` instead of this caller's own `views`
    // (the CRM-only fixture's mutation above) can NOT be caught here: this
    // fixture's `views` already IS `SETUP_STEP_KEYS` in the same order, so
    // both indexing strategies agree.
    expect(visibleNumbers(html)).toEqual(["01", "02", "03", "04", "06", "07", "08"]);
  });
});
