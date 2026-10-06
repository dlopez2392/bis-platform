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

  // Full plan: the lock graph (website_assistant needs voice_profile done;
  // test_call needs number+voice_profile done; go_live needs five) makes it
  // impossible for every one of the ten to be simultaneously undone AND
  // unlocked — something always has to be marked done to unlock something
  // later, which hides THAT entry's own number behind a Check icon instead
  // (the same real constraint the wizard itself has). account, branding and
  // hours are the three steps nothing ever locks on, so they are the
  // reliable sample: their numbers must still read 01/02/03, in order, for
  // the full ten-entry rail — proving the full-plan source (`views` itself,
  // in `deriveSetupStatus`'s canonical order) still numbers correctly, the
  // same source the CRM-only case above reads.
  it("still numbers the full plan's unlockable early steps 01, 02, 03 in order, and renders all ten titles", () => {
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
    expect(visibleNumbers(html).slice(0, 3)).toEqual(["01", "02", "03"]);
  });
});
