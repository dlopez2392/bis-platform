import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Imported at module scope by the composer; never called during a server render.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageComposer, composeModeFromHash, smsFormBlock } from "./message-composer";
import { m } from "@/lib/messages";

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

describe("MessageComposer's mode tabs (design check 1a, M1)", () => {
  it("are on the control radius, never rounded-md's off-scale 10px (mutation: put back rounded-md -> FAILS)", () => {
    const tabs = render().match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g) ?? [];
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(tab).toContain("rounded-[var(--radius-ctl)]");
      expect(tab).not.toMatch(/\brounded-md\b/);
    }
  });
});

describe("MessageComposer's body field (D-015)", () => {
  it("renders the body as a textarea, not a single-line input (mutation: revert to <Input> → FAILS)", () => {
    const html = render();
    expect(html).toMatch(/<textarea[^>]*name="body"/);
    expect(html).not.toMatch(/<input[^>]*name="body"/);
  });
});

describe("the header's Text and Email land on the composer (S-03 part 1, spec §9.1)", () => {
  it("maps exactly the two hashes to their channels (mutation: return 'sms' for #compose-email -> FAILS)", () => {
    expect(composeModeFromHash("#compose-sms")).toBe("sms");
    expect(composeModeFromHash("#compose-email")).toBe("email");
    expect(composeModeFromHash("")).toBeNull();
    expect(composeModeFromHash("#record-who")).toBeNull();
    expect(composeModeFromHash("#compose-note")).toBeNull();
  });

  it("carries both anchors, so the links scroll to the composer even without JavaScript (mutation: drop an anchor -> FAILS)", () => {
    const html = render();
    expect(html).toContain('id="compose-sms"');
    expect(html).toContain('id="compose-email"');
  });
});

describe("smsFormBlock: the one line the Text tab shows instead of the form", () => {
  const open = { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] };
  it("an unreadable gate fails CLOSED with the unknown line, never an open form (spec §7; mutation: treat null as open -> FAILS)", () => {
    expect(smsFormBlock(null, true, null)).toEqual({ text: m["compose.smsStateUnknown"], consent: false });
  });
  it("keeps today's order: gate, then number, then the consent line", () => {
    expect(smsFormBlock({ ok: false, reason: "a2p_not_approved" }, true, null)).toEqual({ text: m["compose.smsBlockedA2p"], consent: false });
    expect(smsFormBlock({ ok: false, reason: "no_live_number" }, true, null)).toEqual({ text: m["compose.smsBlockedNoNumber"], consent: false });
    expect(smsFormBlock(open, false, "held")).toEqual({ text: m["compose.noPhoneOnContact"], consent: false });
    expect(smsFormBlock(open, true, "held")).toEqual({ text: "held", consent: true });
    expect(smsFormBlock(open, true, null)).toBeNull();
  });
});
