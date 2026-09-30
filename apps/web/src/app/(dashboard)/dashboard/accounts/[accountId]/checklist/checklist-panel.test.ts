import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChecklistPanel } from "./checklist-panel";
import type { ChecklistEntry } from "@/lib/checklist-catalogue";
import { m } from "@/lib/messages";

// The A2P registration card (a2p-panel.tsx) sits below the whole checklist on
// this same page, and danlo could not find it by scrolling. This row gets an
// extra, in-page link to it — a real "#a2p-registration" anchor, distinct
// from the row's own "Open" link to Telnyx, which every other row also has.

function entry(overrides: Partial<ChecklistEntry>): ChecklistEntry {
  return {
    key: "phone_number", title: "Buy a phone number", help: "help text",
    external: true, href: undefined, custom: false, done: false, note: null,
    derived: false,
    ...overrides,
  };
}

function render(entries: ChecklistEntry[]) {
  return renderToStaticMarkup(createElement(ChecklistPanel, {
    entries, formsMissingNotify: 0,
    setAction: async () => {}, addAction: async () => {},
  }));
}

describe("ChecklistPanel — the A2P row's in-page link to its own card", () => {
  it("renders a link to #a2p-registration on the a2p_registration row", () => {
    const html = render([
      entry({ key: "a2p_registration", title: "Register A2P 10DLC brand and campaign", href: "https://portal.telnyx.com/#/messaging-10dlc/brands" }),
    ]);
    expect(html).toContain('href="#a2p-registration"');
    expect(html).toContain(m["checklist.goToA2pCard"]);
    // The existing Telnyx link must still be there — this is additive, not a
    // replacement.
    expect(html).toContain('href="https://portal.telnyx.com/#/messaging-10dlc/brands"');
  });

  it("does not render the in-page link on any other row", () => {
    const html = render([
      entry({ key: "phone_number" }),
      entry({ key: "messaging_profile", href: "https://portal.telnyx.com/#/programmable-messaging/profiles" }),
    ]);
    expect(html).not.toContain('href="#a2p-registration"');
    expect(html).not.toContain(m["checklist.goToA2pCard"]);
  });
});
