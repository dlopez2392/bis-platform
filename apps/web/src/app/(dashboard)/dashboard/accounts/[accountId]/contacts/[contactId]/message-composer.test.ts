import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Imported at module scope by the composer; never called during a server render.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageComposer } from "./message-composer";

/**
 * D-015. Same defect as the Conversations EmailComposer
 * (../../conversations/email-composer.test.ts): the body field was a
 * single-line `<input>`, which cannot hold a typed Enter at all.
 *
 * `mode` defaults to "note" (`useState<Mode>("note")`) with no prop to pick
 * a starting mode, and the three modes' forms are driven by a `key={mode}`
 * remount sharing the exact same body field markup — so this one render,
 * in the default note mode, exercises the shared fix for email and sms too.
 */
function render(): string {
  return renderToStaticMarkup(createElement(MessageComposer, {
    contactId: "c1",
    contactHasEmail: true,
    contactHasPhone: true,
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    smsBlockedLine: null,
    emailNoticeLine: null,
    noteAction: async () => {},
    emailAction: async () => {},
    smsAction: async () => {},
  } as never));
}

describe("MessageComposer's body field (D-015)", () => {
  it("renders the body as a textarea, not a single-line input (mutation: revert to <Input> → FAILS)", () => {
    const html = render();
    expect(html).toMatch(/<textarea[^>]*name="body"/);
    expect(html).not.toMatch(/<input[^>]*name="body"/);
  });
});
